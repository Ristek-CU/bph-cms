# API BPH CMS — Dokumentasi Endpoint Lengkap

**Versi:** 1.1 (per 2 September 2026 — sinkron dengan kode di `main`)
**Base URL produksi:** `https://bph-cms.sga-cakrawala.org/api/v1`
**Base URL dev:** `http://localhost:8791/api/v1`
**OpenAPI spec hidup:** `GET /api/v1/openapi` · UI interaktif (Scalar): `/api/v1/reference`
**Untuk:** developer FE landing page SGA & FE panel admin.

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

- Endpoint admin: header `Authorization: Bearer <token>` (dari sign-in §3). Wajib role `admin`.
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
// 201 — body sama dengan sign-in
```

Catatan: user baru role-nya `user` — tidak bisa akses endpoint admin sampai dijadikan `admin` oleh pengelola superapp.

---

## 4. Endpoint Admin — Event

Semua wajib `Authorization: Bearer <token>` + role `admin`. Tanpa/m salah role → `401` / `403`.

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

Body = subset field di atas (semua opsional). Rentang baru harus tetap menampung sesi lama — kalau tidak → `422` "Event range does not cover existing sessions". `200` → data terbaru.

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
| 403 | Token valid, bukan role admin | `{ success:false, message:"Forbidden" }` |
| 404 | Slug tidak ada / draft / resource tidak ada | `{ success:false, message:"Event not found" }` |
| 409 | Slug sudah dipakai | `{ success:false, message:"Slug already exists" }` |
| 422 | Validasi gagal | `{ success:false, message:"Validation failed", errors: { field: [msg…] } }` |
| 429 | Kena rate limit (§7) | `{ success:false, message:"Terlalu banyak permintaan…" }` |

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

Endpoint publik (`/events*`) dibatasi **60 request/menit per IP + path** (Cloudflare Workers Rate Limiting). Melebihi → `429`. FE: jangan polling rapat; cache klien 60 detik cukup.

---

## Changelog

- **1.1 (2 Sep 2026):** `GET /events/:slug` kini mengembalikan `status` (dihitung server). Rate limit aktif. Dokumen mencakup semua endpoint (auth proxy, admin, media, storage).
- **1.0 (1 Sep 2026):** Rilis awal — contract SDD §4.
