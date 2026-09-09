# API BPH CMS — Dokumentasi Endpoint Lengkap

**Versi:** 1.1 (per 2 September 2026 — sinkron dengan kode di `main`)
**Base URL produksi:** `https://bph-cms.sga-cakrawala.org/api/v1`
**Base URL dev:** `http://localhost:8791/api/v1`
**UI dokumentasi interaktif (Scalar, self-host):** `https://bph-cms.sga-cakrawala.org/api/v1/reference`
**Spec OpenAPI 3.1 (import ke Postman/Insomnia):** `https://bph-cms.sga-cakrawala.org/api/v1/openapi`
**Untuk:** developer FE landing page SGA & FE panel admin.

> **Akses docs & panel:** dokumentasi terbuka untuk semua (read-only). Untuk mencoba endpoint admin via panel: akun dev `ristek@cakrawala.com` (mintakan password ke pengelola). Scalar juga punya tombol "Test Request" — isi Bearer token dari sign-in §3.1.

---

## Daftar Isi

1. [Aturan Umum](#1-aturan-umum)
2. [Endpoint Publik — Event](#2-endpoint-publik--event) (FE landing page)
3. [Endpoint Auth](#3-endpoint-auth) (panel admin)
4. [Endpoint Admin — Event](#4-endpoint-admin--event) (panel admin)
5. [Endpoint Admin — Media & Storage](#5-endpoint-admin--media--storage)
6. [Kode Error & Contoh](#6-kode-error--contoh)
7. [Rate Limit](#7-rate-limit)

---

## 1. Aturan Umum

### Wrapper response (seragam semua CMS SGA)

```json
// sukses
{ "success": true, "message": "OK", "statusCode": 200, "data": ... }
// error
{ "success": false, "message": "...", "statusCode": 422, "errors": { "field": ["pesan"] } }
```

### Timestamp

- Semua input & output **ISO 8601 dengan offset** — contoh: `2026-09-10T08:00:00+07:00`.
- Backend menerima offset apa pun (`Z`, `+07:00`, dst); tampilan FE selalu WIB.
- Regex validasi input: `T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$` (detik opsional).

### Status event

- Kolom DB hanya `draft` / `published`.
- Status tampilan mahasiswa **dihitung server** dari waktu (Asia/Jakarta):
  `ongoing` (now ≥ start && now ≤ end) · `upcoming` (now < start) · `past` (now > end).
- Hanya `published` yang keluar di endpoint publik. Draft = 404.

### Auth

- Endpoint admin: header `Authorization: Bearer <token>` (dari sign-in §3). **Hanya Bearer** —
  sejak 10 Sep 2026 cookie tidak lagi diterima sebagai kredensial.
- Izin admin **bukan** dari role auth service, tapi dari baris `cms_memberships` di CMS Hub
  (`platform_admin` / `division_admin` / `contributor` / `viewer`) → dipetakan ke permission
  di `src/shared/permissions.ts`. Token valid tanpa membership → `permissions` kosong → 403.
- Endpoint publik: tanpa auth.

---

## 2. Endpoint Publik — Event

Tanpa login. Read-only. Cocok untuk landing page (`VITE_BPH_API_URL`).

### 2.1 `GET /events` — daftar event terbit

Query (semua opsional):

| Param | Nilai | Default |
|---|---|---|
| `status` | `ongoing` \| `upcoming` \| `past` | — (semua) |
| `limit` | 1–50 | 12 |
| `page` | ≥ 1 | 1 |

Sortir tetap dari server: ongoing di atas → upcoming terdekat → past terbaru.

```json
{
  "success": true, "message": "OK", "statusCode": 200,
  "data": {
    "items": [
      {
        "id": "0192…",
        "slug": "cakrawala-festival-2026",
        "title": "Cakrawala Festival 2026",
        "description": "Acara tahunan…",
        "cover_image_url": "https://bph-cms.sga-cakrawala.org/api/v1/storage/covers/<uuid>.jpg",
        "starts_at": "2026-09-10T08:00:00+07:00",
        "ends_at": "2026-09-11T17:00:00+07:00",
        "location": "Cakrawala University, Kampus Kemang",
        "location_url": "https://maps.app.goo.gl/…",
        "registration_url": "https://forms.gle/…",
        "registration_open": true,
        "organizer": "BPH SGA",
        "status": "upcoming"
      }
    ],
    "meta": { "current_page": 1, "total": 24, "per_page": 12 }
  }
}
```

Catatan: **list tidak menyertakan `sessions`** — ambil dari detail.

### 2.2 `GET /events/:slug` — detail + runsheet

`sessions[]` sudah urut `starts_at`. 404 bila draft/tidak ada.

```json
{
  "success": true, "message": "OK", "statusCode": 200,
  "data": {
    "id": "0192…", "slug": "cakrawala-festival-2026", "title": "…",
    "description": "…", "cover_image_url": "…",
    "starts_at": "2026-09-10T08:00:00+07:00",
    "ends_at": "2026-09-11T17:00:00+07:00",
    "location": "…", "location_url": "…",
    "registration_url": "…", "registration_open": true,
    "organizer": "…",
    "status": "upcoming",
    "sessions": [
      {
        "id": "0193…",
        "name": "Seminar Teknis: AI di Industri",
        "starts_at": "2026-09-10T13:00:00+07:00",
        "ends_at": "2026-09-10T15:00:00+07:00",
        "speaker": "Nama Pemateri",
        "location": "Auditorium Lt. 2",
        "description": "Membahas…"
      }
    ]
  }
}
```

`speaker`, `location`, `description` sesi **nullable** — jangan render "null".

### 2.3 `GET /events/calendar?month=YYYY-MM` — event per bulan

Event `published` yang rentangnya **beririsan** dengan bulan tersebut (event multi-hari tetap masuk). Untuk komponen kalender bulanan.

```json
{
  "success": true, "message": "OK", "statusCode": 200,
  "data": {
    "items": [
      { "slug": "cakrawala-festival-2026", "title": "…", "starts_at": "…", "ends_at": "…", "location": "…" }
    ]
  }
}
```

Bulan kosong → `200` dengan `items: []`. Format salah → `422`.

---

## 3. Endpoint Auth

Panel admin login via proxy ke service `auth` superapp (better-auth + bearer). Response diteruskan apa adanya.

### 3.1 `POST /auth/sign-in`

```json
// request
{ "email": "user@sga.test", "password": "password123" }
// 200
{ "success": true, "message": "User signed in successfully", "statusCode": 200,
  "data": { "token": "…", "user": { "id": "…", "name": "…", "email": "…", "role": "admin" } } }
// 401
{ "success": false, "message": "Invalid email or password", "statusCode": 401 }
```

Gunakan `data.token` sebagai Bearer token untuk semua endpoint admin.

### 3.2 `POST /auth/sign-up`

```json
{ "name": "Nama Lengkap", "email": "user@sga.test", "password": "min8karakter" }
// 200 — body sama dengan sign-in
{ "success": true, "message": "Sign up berhasil", "statusCode": 200,
  "data": { "token": "…", "user": { "id": "…", "email": "…", "name": "…", "role": "user" } } }
```

Diperbarui 10 Sep 2026:

- Status sukses **200**, bukan 201.
- Endpoint ini sebelumnya **404 di production**: proxy mengarah ke `/v1/access/sign-up`,
  sedangkan authRouter service auth yang terdeploy tidak punya route itu. Sekarang proxy
  diarahkan ke endpoint native better-auth `/v1/access/sign-up/email` dan responsnya yang
  polos (`{ token, user }`) dibungkus ulang supaya bentuknya sama dengan sign-in.
- Dibatasi rate limit **10 request / 15 menit per IP**.
- Catatan akses: user baru dapat role `user` di auth service, tetapi role itu **bukan**
  penentu akses panel. Akses CMS Hub berasal dari baris `cms_memberships`
  (`platform_admin` / `division_admin` / `contributor` / `viewer`). Tanpa membership,
  `permissions` kosong dan semua endpoint admin membalas 403. Lihat
  [DIVISION-ACCOUNTS.md](./DIVISION-ACCOUNTS.md) dan [RUNNING-GUIDE.md §12](./RUNNING-GUIDE.md).

---

## 4. Endpoint Admin — Event

Semua wajib `Authorization: Bearer <token>` **dan** membership aktif dengan permission yang
cukup untuk divisi target. Token hilang/invalid → `401`; token valid tapi permission atau
kepemilikan divisi tidak cocok → `403`.

Scope per role:

| Role | Event divisi sendiri | Event divisi lain | Publish/delete | QPR, Akun, Audit |
|---|---|---|---|---|
| `platform_admin` | ya | ya (`.all`) | ya | ya |
| `division_admin` | ya | 403 | ya | 403 |
| `contributor` | draft saja | 403 | 403 | 403 |
| `viewer` | baca saja | 403 | 403 | 403 |

Header opsional `X-Division-Id` memilih divisi aktif untuk user dengan lebih dari satu
membership. Mengisinya dengan divisi yang bukan membership user **diabaikan** — fallback ke
membership pertama, jadi header ini tidak bisa dipakai menyeberang divisi.

### 4.1 `GET /admin/events` — semua event (termasuk draft) + sessions

Tanpa pagination (ambil semua — panel lokal difilter klien).

```json
{ "success": true, "message": "OK", "statusCode": 200, "data": [
  {
    "id": "0192…", "slug": "…", "title": "…", "description": "…",
    "cover_image_url": "…", "starts_at": "…", "ends_at": "…",
    "location": "…", "location_url": "…", "registration_url": "…",
    "registration_open": true, "organizer": "…",
    "status": "draft",            // "draft" | "published" — status tampilan dihitung klien dari waktu
    "sessions": [
      { "id": "…", "name": "…", "starts_at": "…", "ends_at": "…", "speaker": "…", "location": "…", "description": "…" }
    ]
  }
] }
```

### 4.2 `POST /admin/events` — buat event (+ sessions inline opsional)

Body (yang bertanda * wajib):

| Field | Tipe | Catatan |
|---|---|---|
| `title` * | string 1–200 | |
| `starts_at` * | ISO+offset | |
| `ends_at` * | ISO+offset | harus > `starts_at` |
| `location` * | string 1–300 | |
| `slug` | kebab-case 3–120 | opsional — auto dari title bila kosong |
| `description` | string ≤ 10.000 | nullable |
| `cover_image_url` | URL | dari §5.1 |
| `location_url` | URL | link Maps |
| `registration_url` | URL | link form pendaftaran |
| `registration_open` | boolean | default `true` |
| `organizer` | string ≤ 200 | nullable |
| `sessions` | array ≤ 100 | tiap sesi lihat §4.6 |

```json
{
  "title": "Cakrawala Festival 2026",
  "slug": "cakrawala-festival-2026",
  "starts_at": "2026-09-10T08:00:00+07:00",
  "ends_at": "2026-09-11T17:00:00+07:00",
  "location": "Cakrawala University",
  "sessions": [
    { "name": "Pembukaan", "starts_at": "2026-09-10T08:00:00+07:00", "ends_at": "2026-09-10T09:00:00+07:00" }
  ]
}
```

`201` → data event lengkap + `sessions` (seperti GET detail). Slug dipakai → `409`.
Validasi gagal → `422` `errors` (mis. `sessions.0: ["Session must be within the event time range"]`).

### 4.3 `PUT /admin/events/:id` — update parsial

Body = subset field di atas (semua opsional). Jika `sessions` dikirim, seluruh runsheet event diganti sesuai array tersebut. Jika `sessions` tidak dikirim, rentang baru harus tetap menampung sesi lama — kalau tidak → `422` "Event range does not cover existing sessions". `200` → data terbaru.

### 4.4 `DELETE /admin/events/:id` — hapus permanen

Sesi ikut terhapus (cascade). `200`. Tidak ada soft delete.

### 4.5 `POST /admin/events/:id/publish` dan `/unpublish`

Publish → tampil di endpoint publik. Unpublish → kembali draft (publik 404). `200` → data event.

### 4.6 Sesi (runsheet)

**Tambah ke event:** `POST /admin/events/:id/sessions`

```json
{ "name": "Seminar Teknis", "starts_at": "2026-09-10T13:00:00+07:00", "ends_at": "2026-09-10T15:00:00+07:00", "speaker": null, "location": null, "description": null }
```

**Ubah:** `PUT /admin/sessions/:id` (body parsial sama).
**Hapus:** `DELETE /admin/sessions/:id`.
**Urutkan ulang:** `PUT /admin/events/:id/sessions/order` — body `{ "session_ids": ["id1", "id2", …] }` (array id dalam urutan baru; id asing → `422`).

Semua mengembalikan `200/201` dengan data event lengkap + sessions terbaru. Aturan: sesi harus di dalam rentang event dan `ends_at > starts_at`.

---

## 5. Endpoint Admin — Media & Storage

### 5.1 `POST /admin/media` — upload gambar

`multipart/form-data`, field `file`. Batas: JPG/PNG/WebP, maks 5MB. Wajib auth admin.

```json
// 201
{ "success": true, "message": "Media uploaded", "statusCode": 201,
  "data": { "url": "https://bph-cms.sga-cakrawala.org/api/v1/storage/covers/<uuid>.jpg" } }
```

Simpan URL itu ke `cover_image_url`. Nama file di-sanitize (uuidv7) — aman.

### 5.2 `GET /storage/:key` — akses file (publik, tanpa auth)

Dilayani dari R2, `Cache-Control: public, max-age=31536000, immutable` — aman di-cache selamanya (URL unik per upload).

---

## 6. Kode Error & Contoh

| Kode | Kapan | Body |
|---|---|---|
| 400 | Body bukan JSON valid | `{ success:false, message:"Invalid JSON body" }` |
| 401 | Token hilang/salah, draft di endpoint publik* | `{ success:false, message:"Unauthorized" }` |
| 403 | Token valid, tapi permission/kepemilikan divisi tidak cukup | `{ success:false, message:"Forbidden: …" }` |
| 404 | Slug tidak ada / draft / resource tidak ada | `{ success:false, message:"Event not found" }` |
| 409 | Slug sudah dipakai | `{ success:false, message:"Slug already exists" }` |
| 422 | Validasi gagal | `{ success:false, message:"Validation failed", errors: { field: [msg…] } }` |
| 429 | Kena rate limit (§7) | `{ success:false, message:"Terlalu banyak permintaan…" }` |
| 500 | Error tak terduga (D1, dsb.) | `{ success:false, message:"Internal server error", requestId:"…" }` |

Semua respons error sekarang menyertakan `requestId` (dari middleware `requestId`). Pakai itu
untuk mencocokkan dengan log Worker — pesan error internal **sengaja tidak** dikirim ke klien.
Sebelum 10 Sep 2026 body 500 berisi `err.message` mentah, yang untuk error D1 memuat nama
tabel, potongan SQL, dan params query.

*Draft di `/events/:slug` = 404, bukan 401.

Contoh 422:

```json
{ "success": false, "message": "Validation failed", "statusCode": 422,
  "errors": { "ends_at": ["ends_at must be after starts_at"] } }

{ "success": false, "message": "Validation failed", "statusCode": 422,
  "errors": { "sessions.0": ["Session must be within the event time range"] } }
```

Key `errors` mengikuti path field (`sessions.<index>` / `sessions.<index>.starts_at`).

---

## 7. Rate Limit

Diperbarui 10 Sep 2026. Limit ditegakkan oleh **counter fixed-window di D1**
(`src/db/rate-limit.ts`, tabel `rate_limits`), bukan oleh binding `RATE_LIMITER`.

| Endpoint | Limit | Key |
|---|---|---|
| `GET /events*` (publik) | 120 / menit | IP + path |
| `POST /auth/sign-in` | 20 / 15 menit | IP + path + email |
| `POST /auth/sign-in` | 60 / 15 menit | IP + path |
| `POST /auth/sign-up` | 10 / 15 menit | IP + path |

Melebihi → `429`. FE: jangan polling rapat; cache klien 60 detik cukup.

Dua lapis dipasang pada sign-in: yang per-email menahan tebakan password pada satu akun,
yang per-IP menahan password spraying ke banyak email.

> Binding `RATE_LIMITER` (Cloudflare Workers Rate Limiting, 60/60s) **masih terpasang tetapi
> tidak menegakkan apa pun di production** — selalu membalas `success: true`. Diverifikasi
> 10 Sep 2026: 200 request beruntun ke `/api/v1/events` menghasilkan nol 429, sementara kode
> yang sama di `wrangler dev` memblokir di request ke-61. Binding itu dipertahankan hanya
> sebagai lapisan murah dengan `skip` guard. Angka 60/menit yang tertulis di versi lama
> dokumen ini tidak pernah berlaku di production.

Limit publik 120 (bukan 60) sengaja lebih longgar supaya banyak user di satu NAT kampus
tidak saling mengunci.

---

## Changelog

- **1.2 (10 Sep 2026):** Perbaikan keamanan + koreksi dokumentasi.
  - Rate limit **benar-benar aktif** sekarang, lewat counter D1 (§7). Entri 1.1 yang menyebut
    "Rate limit aktif" tidak akurat: binding Cloudflare terpasang tetapi tidak pernah
    menegakkan limit, dan `/auth/sign-in` tidak dibatasi sama sekali.
  - Izin admin dijelaskan ulang berbasis `cms_memberships` + permission, bukan "role admin" (§Auth, §4).
  - `POST /auth/sign-up` diperbaiki — sebelumnya 404 di production (§3.2).
  - Cookie tidak lagi diterima sebagai kredensial; hanya `Authorization: Bearer`.
  - Body 500 tidak lagi membocorkan pesan error internal; semua respons error membawa `requestId`.
  - `X-Division-Id` masuk `Access-Control-Allow-Headers`.
  - Header keamanan ditambahkan pada respons Worker (nosniff, `X-Frame-Options: DENY`, CSP, Referrer-Policy).
- **1.1 (2 Sep 2026):** `GET /events/:slug` kini mengembalikan `status` (dihitung server). Rate limit aktif. Dokumen mencakup semua endpoint (auth proxy, admin, media, storage).
- **1.0 (1 Sep 2026):** Rilis awal — contract SDD §4.
