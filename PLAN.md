# PLAN.md — Eksekusi CMS BPH (Modul Student Event)

> Sumber: [SDD §10](./docs/SDD.md) · [CONTEXT §5](./docs/CONTEXT.md)
> Eksekusi M1→M6 berurutan. Tiap milestone = commit atomik `feat: ...`.
> Level: caveman full + ponytail full.

---

## Keputusan internal (naming/struktur — bebas, dicatat di sini)

| # | Keputusan | Alasan |
|---|---|---|
| D1 | **Standalone Worker repo** (bukan `apps/bph-cms` di superapp) | Repo ini sudah dibuat standalone; SDD A9 opsi 1 |
| D2 | Wrapper (`ApiResponse`/`ApiError`/`errorHandler`/`STATUS_CODES`) **di-copy lokal** ke `src/shared/` | Standalone repo → `@internal/shared` tidak bisa di-import. Sumber: `docs/reference-api-response.ts` |
| D3 | Pagination meta ikut **contract SDD §4.1**: `{ items, meta: { current_page, total, per_page } }` | Bukan shape `buildPaginatedResult` shared (`pagination.totalPages`). Contract final |
| D4 | Validation error = **422** dengan `errors: { field: [msg] }` | PRD §2.3 + CONTEXT §6. Shared `ApiError.validation` default 400 → pakai 422 |
| D5 | Schema + kolom internal `starts_at_ms`/`ends_at_ms` (INTEGER, epoch ms) | Sort/filter status di SQL tanpa parsing string ISO-varian-offset. API tetap kirim ISO 8601 + offset |
| D6 | OpenAPI: Scalar UI di **`/reference`**, spec JSON di `/openapi` | SDD A6 + CONTEXT: "OpenAPI spec di /reference" (superapp lain pakai `/docs` — beda di sini) |
| D7 | Modul `sessions` ditempel di `modules/events/` (bukan folder terpisah) | Sesi tidak hidup tanpa event; 1 modul, route tetap terpisah |
| D8 | Media: R2 binding, dilayani via `GET /api/v1/storage/*` (pola ukm-profile, `Cache-Control: immutable`) | Tidak perlu public bucket; URL final disimpan di `cover_image_url` |
| D9 | Migrasi: `drizzle-kit generate` → `wrangler d1 migrations apply` | Sama seperti app auth superapp (`migrations_dir = drizzle`) |
| D10 | Auth: middleware sendiri memanggil `AUTH_SERVICE` binding `GET /v1/auth/session` (pola `gateway-api/src/middlewares/auth.ts`), lalu `requireRole("admin")` | Bukan di belakang gateway — Worker terpisah dengan binding langsung |

## Verifikasi asumsi SDD → kondisi nyata

| Asumsi SDD | Status | Catatan |
|---|---|---|
| §2 app baru di monorepo `apps/bph-cms` | **Usang** | Repo dibuat standalone. Tetap tiru pola file `apps/auth`/`apps/ukm-profile`. Diketik di [CONTEXT.md §9](./docs/CONTEXT.md) |
| §2 ambil `@internal/shared` | **Tidak bisa** | Workspace package — tidak terlihat dari repo lain. Solusi D2 (copy, sudah ada referensinya) |
| A4 auth via service binding `AUTH_SERVICE` | ✅ Valid | Pola persis ada di `gateway-api/src/middlewares/auth.ts`. Binding `sga-superapp-auth` satu akun CF |
| A2 Drizzle + D1, `d1-http` di drizzle-kit | ✅ Valid | Pola `drizzle.config.ts` auth/ukm-profile (baca `.dev.vars`) |
| A3 R2 | ✅ Valid | Pola `BUCKET` + serve `/storage/*` di ukm-profile |
| A8 UUIDv7 | ✅ Valid | dep `uuidv7` dipakai app auth |
| A6 hono-openapi + Scalar | ✅ Valid | Dep versi: `hono-openapi@^1.3.0`, `@scalar/hono-api-reference`, `@hono/standard-validator`, `zod@^4` |

Risiko dev yang disadari: `AUTH_SERVICE` binding butuh worker `sga-superapp-auth` hidup.
Local dev: jalankan `pnpm --filter auth dev` di superapp atau tandai binding `remote`.
Middleware auth dibuat **injectable** supaya bisa di-stub saat dev/test.

---

## Dependency graph

```
M1 scaffold ──► M2 admin auth ──► M3 CRUD ──► M4 publik ──► M6 OpenAPI+test
                     │                        ▲
                     └──► M5 media+publish ───┘
```
(M5 hanya butuh M2+M3; urutan kerja tetap M1→M6 linear.)

---

## M1 — Scaffold Worker + D1 + schema

**Files (buat):**
- `package.json` — deps: `hono`, `drizzle-orm`, `zod`, `@hono/standard-validator`, `hono-openapi`, `@scalar/hono-api-reference`, `uuidv7`; dev: `wrangler`, `drizzle-kit`, `@cloudflare/workers-types`, `tsx`
- `wrangler.jsonc` — worker `sga-superapp-bph-cms`, D1 binding `DB` (buat via `wrangler d1 create bph-cms-db`), R2 binding `BUCKET` (`bph-cms-media`, M5), `[[services]] AUTH_SERVICE`, vars `CORS_ORIGIN`, `API_BASE_URL`
- `tsconfig.json`
- `src/index.ts` — Hono + `requestId` + CORS (whitelist dari env) + `onError(errorHandler)` + route `/api/v1`
- `src/types.ts` — `Bindings` (DB, BUCKET, AUTH_SERVICE, vars), `Variables` (db, userId, userRole), `AppContext`
- `src/shared/` — `api-response.ts`, `api-error.ts`, `status-codes.ts`, `error-handler.ts` (copy dari `docs/reference-api-response.ts` + superapp, tambah `UNPROCESSABLE_ENTITY: 422`)
- `src/db/connection.ts` — pola auth superapp (`getDb`, `dbMiddleware`, cache)
- `src/db/schema.ts` — tabel `events`, `event_sessions` (SDD §3 + kolom ms D5, index persis SDD §3)
- `drizzle.config.ts` — sqlite, d1-http, baca `.dev.vars`
- `.dev.vars.example`
- `src/modules/events/status.ts` — `computeStatus(startsAt, endsAt, now)` pure (dipakai M4, ditest M6)

**Setup:** `wrangler d1 create bph-cms-db` → simpan `database_id`; `drizzle-kit generate`; `wrangler d1 migrations apply bph-cms-db --local`.

**Selesai bila:** `wrangler dev` hidup, `GET /` return wrapper `{ success, message, statusCode }`, tabel terbentuk di D1 lokal.

**Estimasi:** ½ hari.

---

## M2 — Auth admin via service binding

**Files:**
- `src/middlewares/admin-auth.ts` — (1) ambil `Authorization`/`Cookie` header; (2) `AUTH_SERVICE.fetch("http://internal/v1/auth/session", {headers})`; (3) non-OK / `data.user` kosong → `ApiError.unauthorized`; (4) `c.set("userId"/"userRole")`
- `src/middlewares/require-role.ts` — factory `requireRole("admin")` → 403
- Mount: semua `/api/v1/admin/*` di belakang `adminAuth` + `requireRole("admin")`

**Verifikasi:** curl tanpa token → 401 shape konsisten; token sampah → 401; (integrasi role → M3 dengan auth worker hidup).

**Estimasi:** ¼ hari.

---

## M3 — CRUD event + sessions + validasi

**Files:**
- `src/modules/events/event.schema.ts` — zod: create (dengan `sessions[]` inline, SDD §4.3), update partial; `paginationQuerySchema` lokal (limit default 12, max 50 — contract SDD, beda dari shared)
- `src/modules/events/event.service.ts` — slug auto dari title (kebab-case, unik via suffix), validasi silang: `ends_at > starts_at`, tiap sesi `ends_at > starts_at` + di dalam rentang event, URL valid, duplikat slug → 422 errors map
- `src/modules/events/event.controller.ts`
- `src/modules/events/event.route.ts` — `POST/PUT/DELETE /admin/events`, `POST /admin/events/:id/sessions`, `PUT/DELETE /admin/sessions/:id`, `PUT /admin/events/:id/sessions/order`
- Error duplikat slug → 409 `ApiError.conflict`

**Selesai bila:** end-to-end via Scalar/curl: create (session inline) → update → reorder → delete; payload invalid → 422 `{ errors: { field: [msg] } }`.

**Estimasi:** 1 hari.

---

## M4 — Endpoint publik + status dihitung server

**Files:**
- `src/modules/events/status.ts` (sudah dibuat M1) — `ongoing` (now ≥ starts && now ≤ ends), `upcoming` (now < starts), `past` (now > ends); zona Asia/Jakarta via offset ISO
- `src/modules/events/event.service.ts` (tambah) — `listPublic` (filter status, sort: ongoing atas → upcoming terdekat → past terbaru, pagination `meta`), `getBySlug` (404 jika draft/tak ada), `getCalendar(month=YYYY-MM)` (overlap bulan WIB, field ringkas)
- `src/modules/events/event.route.ts` (tambah publik): `GET /events`, `GET /events/:slug`, `GET /events/calendar` — **daftar sebelum `:slug`** agar tidak tertelan param
- List tanpa `sessions`; detail urut `starts_at`; draft tidak pernah keluar

**Selesai bila:** contract SDD §4.1 match field-per-field (dummy JSON FE cocok).

**Estimasi:** ½ hari.

---

## M5 — Upload R2 + publish/unpublish

**Files:**
- `src/modules/media/media.route.ts` + `media.controller.ts` — `POST /admin/media` multipart: cek MIME JPG/PNG/WebP, ≤ 5MB, nama file di-sanitize, key `covers/<uuidv7>.<ext>` → `BUCKET.put`; return `{ url: ${API_BASE_URL}/storage/<key> }`
- `src/index.ts` — route publik `GET /api/v1/storage/*` → `BUCKET.get`, `Cache-Control: public, max-age=31536000, immutable`
- `event.service.ts` (tambah) — `publish/unpublish`: set `status='published'|'draft'`; 404 id tak ada

**Selesai bila:** upload cover → URL hidup → event dengan `cover_image_url` itu publish → muncul di endpoint publik.

**Estimasi:** ½ hari.

---

## M6 — OpenAPI + self-check test + review

**Files:**
- `describeRoute` + `resolver` + `validator` di semua route (pola ukm-profile); `GET /openapi` (spec JSON); `GET /reference` (Scalar)
- `src/modules/events/status.test.ts` — assert polos (no framework): tepat mulai/selesai, sebelum, sesudah, lintas hari, multi-hari; plus kasus tolak: sesi di luar rentang, slug duplikat (fungsi validasi dipanggil langsung)
- `package.json` script: `"test": "tsx src/modules/events/status.test.ts"`
- Update `docs/CONTEXT.md` §8 status repo

**Selesai bila:** `pnpm test` hijau; `/reference` render; smoke test end-to-end (create→upload→publish→list publik) OK.

**Estimasi:** ½ hari.

**Total:** ± 3.5 hari kerja.

---

## Checklist contract (harus match SDD §4 sebelum commit M6)

- [ ] Wrapper: `{ success, message, statusCode, data }` / error + `errors: { field: [msg] }`
- [ ] `GET /api/v1/events?status=&limit=&page=` — limit 12 default, max 50, meta `{ current_page, total, per_page }`, list tanpa `sessions`
- [ ] Sortir list: ongoing di atas, upcoming terdekat dulu, past terbaru dulu
- [ ] `GET /api/v1/events/:slug` — detail + `sessions[]` urut `starts_at`; 404 draft/tak ada
- [ ] `GET /api/v1/events/calendar?month=YYYY-MM` — overlap bulan WIB; field `slug,title,starts_at,ends_at,location`
- [ ] Status dihitung server (Asia/Jakarta), bukan kolom input
- [ ] ISO 8601 + offset di semua timestamp
- [ ] Admin wajib session auth + role `admin`; publik read-only GET
- [ ] Validasi: required, `ends_at > starts_at`, sesi dalam rentang, URL valid, upload JPG/PNG/WebP ≤ 5MB, 422 shape
- [ ] CORS whitelist LP + admin panel; rate limit publik (`@hono-rate-limiter/cloudflare`)
