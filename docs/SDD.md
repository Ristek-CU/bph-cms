# SDD — CMS BPH: Software Design Document

**Versi:** 1.0
**Tanggal:** 1 September 2026
**Scope:** Backend CMS BPH — modul Student Event
**Terhubung:** [PRD](./PRD.md) · [Requirement v1.2 (PDF)](./SGA-CMS-Student-Event-Requirement.pdf)

---

## 1. Keputusan Arsitektur

| # | Keputusan | Pilihan | Alasan |
|---|---|---|---|
| A1 | Runtime | **Cloudflare Workers** (Hono + TypeScript) | Konsisten ekosistem `sga-superapp` (gateway-api sudah Hono/Workers); satu billing, satu dashboard |
| A2 | Database | **D1 (SQLite)** + Drizzle ORM | Pola sudah dipakai app `auth` & `sga-profile` di superapp |
| A3 | Media (cover) | **R2**, URL publik disimpan di field `cover_image_url` | Sama ekosistem; FE hanya butuh URL final |
| A4 | Auth | **better-auth** di service `auth` superapp; CMS BPH memvalidasi session via binding/panggilan internal | Satu auth untuk seluruh superapp, sesuai keputusan ekosistem |
| A5 | Validasi | Zod + `@hono/standard-validator` | Sudah jadi dependensi superapp |
| A6 | API doc | `hono-openapi` + Scalar (`/reference`) | Sudah jadi pola repo |
| A7 | Timezone | Simpan ISO 8601 dengan offset; server menghitung status dengan zona **Asia/Jakarta** | Menghindari pergeseran jam |
| A8 | ID | UUIDv7 (mengikuti `uuidv7` yang dipakai app auth) | Sortable, index-friendly |
| A9 | Deployment | Workers terpisah: `sga-superapp-bph` (atau masuk monorepo superapp sebagai app baru `apps/bph-api`) | Konsisten dengan gateway → service binding |

**Posisi arsitektur:** CMS BPH = **service backend terpisah** (bukan bagian landing page —
LP tidak punya backend; dan bukan bagian Advocation yang beda domain).

```
Landing Page (CF Pages, static)
  └── GET https://api.<domain>/api/v1/events ...   (read-only, publik)
                          │
                  ┌───────┴──────────────────────────┐
                  │  CMS BPH (Cloudflare Worker)      │
                  │  - modul event (sekarang)         │
                  │  - modul QPR (nanti)              │
                  │  - admin panel API + auth         │
                  └──────┬───────────────┬────────────┘
                         │               │
                     [D1 database]   [R2 media]
```

---

## 2. Struktur Proyek

Rekomendasi: **app baru di monorepo `sga-superapp`** (`apps/bph-cms`), meniru pola `apps/auth`:

```
apps/bph-cms/
├── drizzle/                    # migrasi (drizzle-kit generate)
├── src/
│   ├── index.ts                # entry Hono
│   ├── db/
│   │   ├── connection.ts
│   │   └── schema.ts           # events, event_sessions (+ nanti: qpr_forms)
│   ├── modules/
│   │   ├── events/
│   │   │   ├── event.route.ts
│   │   │   ├── event.controller.ts
│   │   │   ├── event.service.ts
│   │   │   └── event.schema.ts # zod
│   │   ├── sessions/ (idem)
│   │   ├── media/
│   │   └── admin/ (auth guard reuse service auth via service binding)
│   └── types.ts
├── wrangler.toml               # D1 binding, R2 binding, vars
└── package.json
```

Middleware & util (`ApiError`, `ApiResponse`, pagination, error-handler, logger) **diambil dari
`@internal/shared`** — jangan ditulis ulang.

---

## 3. Skema Database (Drizzle / D1)

```sql
-- events
CREATE TABLE events (
  id                 TEXT PRIMARY KEY,            -- uuid v7
  slug               TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  description        TEXT,
  cover_image_url    TEXT,
  starts_at          TEXT NOT NULL,               -- ISO 8601 + offset
  ends_at            TEXT NOT NULL,
  location           TEXT NOT NULL,
  location_url       TEXT,
  registration_url   TEXT,
  registration_open  INTEGER NOT NULL DEFAULT 1,
  organizer          TEXT,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX events_slug_idx ON events (slug);
CREATE INDEX events_starts_at_idx ON events (starts_at);
CREATE INDEX events_status_starts_idx ON events (status, starts_at);

-- event_sessions
CREATE TABLE event_sessions (
  id          TEXT PRIMARY KEY,                  -- uuid v7
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  starts_at   TEXT NOT NULL,
  ends_at     TEXT NOT NULL,
  speaker     TEXT,
  location    TEXT,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX event_sessions_event_idx ON event_sessions (event_id, starts_at);
```

Catatan:
- SQLite (D1): timestamp disimpan string ISO 8601 (dengan offset) — konsisten dengan A7.
- Index `events_status_starts_at_idx` untuk query list + filter status.
- Hapus event = cascade sessions.

---

## 4. Contract API (final — FE sudah berbasis ini)

Wrapper: `ApiResponse` dari `@internal/shared`:

```json
// sukses
{ "success": true, "message": "OK", "data": ... }
// error
{ "success": false, "message": "...", "errors": { "field": ["pesan"] } }
```

### 4.1 Endpoint publik (tanpa auth, read-only)

| Endpoint | Keterangan |
|---|---|
| `GET /api/v1/events?status=upcoming\|ongoing\|past&limit=&page=` | List event published. Default limit 12 (max 50). Sortir: ongoing di atas, upcoming terdekat dulu, past terbaru dulu. Response `data` = `{ items: [...], meta: { current_page, total, per_page } }`. Field list **tanpa** `sessions` |
| `GET /api/v1/events/:slug` | Detail + `sessions[]` urut `starts_at`. 404 jika slug tidak ada / masih draft |
| `GET /api/v1/events/calendar?month=YYYY-MM` | Event yang rentangnya beririsan dengan bulan tsb (multi-hari tetap masuk). Ringkas: `slug, title, starts_at, ends_at, location` |

**Status dihitung server** (wajib, bukan kolom):
`ongoing` jika now ≥ starts_at && now ≤ ends_at · `upcoming` jika now < starts_at · `past` jika now > ends_at. Zona: Asia/Jakarta.

### 4.2 Endpoint admin (auth via service `auth`)

| Endpoint | Fungsi |
|---|---|
| `POST /api/v1/admin/events` | Buat event (+sessions inline) |
| `PUT /api/v1/admin/events/:id` | Update (partial ok) |
| `DELETE /api/v1/admin/events/:id` | Hapus permanen (+sessions cascade) |
| `POST /api/v1/admin/events/:id/publish` / `/unpublish` | Kontrol publikasi |
| `POST /api/v1/admin/events/:id/sessions` | Tambah sesi |
| `PUT/DELETE /api/v1/admin/sessions/:id` | Ubah/hapus sesi |
| `PUT /api/v1/admin/events/:id/sessions/order` | Susun ulang runsheet (array id) |
| `POST /api/v1/admin/media` | Upload cover (multipart) → `{ url }` |

### 4.3 Contoh payload

```json
{
  "slug": "cakrawala-festival-2026",
  "title": "Cakrawala Festival 2026",
  "description": "Tahunan...",
  "cover_image_url": "https://...",
  "starts_at": "2026-09-10T08:00:00+07:00",
  "ends_at": "2026-09-11T17:00:00+07:00",
  "location": "Cakrawala University, Kampus Kemang",
  "location_url": "https://maps.google.com/...",
  "registration_url": "https://...",
  "registration_open": true,
  "organizer": "BEM",
  "sessions": [
    {
      "name": "Seminar Teknis: AI di Industri",
      "starts_at": "2026-09-10T13:00:00+07:00",
      "ends_at": "2026-09-10T15:00:00+07:00",
      "speaker": "Nama Pemateri",
      "location": "Auditorium Lt. 2"
    }
  ]
}
```

### 4.4 Validasi (server-side, wajib)

- Wajib: `title`, `starts_at`, `ends_at`, `location`.
- `ends_at > starts_at`; tiap sesi juga; **sesi tidak boleh di luar rentang event**.
- Slug auto dari judul (kebab-case, unik), bisa di-override.
- `location_url`, `registration_url` harus URL valid.
- Upload: JPG/PNG/WebP ≤ 5MB.
- Error 422: `{ success:false, message, errors: { field: [msg] } }`.

---

## 5. Autentikasi Admin

- Service `auth` (sudah ada di superapp, better-auth + D1) tetap jadi sumber identitas.
- CMS BPH **tidak membuat tabel user sendiri**; verifikasi session via **service binding**
  `AUTH_SERVICE` (pola sudah ada di `gateway-api/src/middlewares/auth.ts`).
- Admin panel SPA nanti deploy sebagai halaman terpisah (mis. `cms.sga-cakrawala.org`) —
  di luar scope BE-fokus ini, API-nya yang disiapkan sekarang.

---

## 6. Keamanan

| Aspek | Kebijakan |
|---|---|
| Endpoint publik | Read-only GET; hanya `published`; rate limit (pola `@hono-rate-limiter` gateway) |
| Admin endpoint | Wajib session valid dari service auth; role `admin` (single-role v1) |
| Upload | Validasi MIME + size; nama file di-sanitize; R2 public bucket hanya untuk cover |
| Input | Zod di semua route; SQL parametris (Drizzle) |
| CORS | Whitelist domain LP + admin panel (dev + prod) |
| Rate limit login | Limiter khusus auth (pola `AUTH_LIMITER` di gateway) |

---

## 7. Observability & Ops

- `access-log` + `request-id` middleware dari `@internal/shared` (sudah tersedia).
- Error handler terpusat (`error-handler.ts` shared) — jangan catch per-route.
- Env & secrets via `wrangler` vars/secret (`keep_vars = true`).
- OpenAPI spec auto dari `hono-openapi` → jadi kontrak hidup FE.

---

## 8. Fase 2 — Google Calendar Sync (gambaran, bukan scope sekarang)

- Saat event di-publish: Worker sign JWT service account (Web Crypto / `jose`), call
  Calendar REST API untuk create/update/cancel event di kalender publik SGA.
- Prasyarat: GCP project, enable Calendar API, service account JSON, share kalender ke SA.
- Secret disimpan di Worker secrets (`wrangler secret put`).
- Fase 1 FE sudah menutup kebutuhan user lewat template URL — fase 2 tidak memblok rilis modul.

---

## 9. Testing & Acceptance (BE)

- Unit: perhitungan status (ongoing/upcoming/past) termasuk edge (tepat mulai/selesai, lintas hari, multi-hari).
- Validasi: sesi di luar rentang event ditolak; slug duplikat ditolak.
- Endpoint publik: draft tidak bocor; 404 shape benar; pagination meta benar.
- One runnable check: test self-check kecil untuk logika status (pola assert, tanpa framework).

---

## 10. Milestone BE (disarankan)

| # | Deliverable | Kriteria selesai |
|---|---|---|
| M1 | Scaffold app `bph-cms` di monorepo (Hono + Drizzle + D1 + schema + migrasi) | `wrangler dev` jalan, tabel terbentuk |
| M2 | Auth admin via service binding + middleware guard | Admin endpoint terlindungi |
| M3 | CRUD event + sessions + validasi | Postman/Scalar bisa end-to-end |
| M4 | Endpoint publik (list/detail/calendar) + status dihitung server | Contract §4 persis |
| M5 | Upload media (R2) + publish/unpublish | Alur admin lengkap |
| M6 | OpenAPI + test status + review | Siap integrasi FE |
