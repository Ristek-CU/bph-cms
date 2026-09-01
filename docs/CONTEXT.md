# CONTEXT.md — Baca Ini Sebelum Ngoding

> File ini untuk agent/developer yang baru buka repo. Baca berurutan:
> `PRD.md` → `SDD.md` → sisa dokumen di folder ini. Semua konteks ada di sini.

## 1. Apa ini

**bph-cms** = service backend CMS milik divisi BPH SGA Cakrawala. Menangani:

- **Modul Student Event** ← *yang dikerjakan sekarang* (lihat [PRD.md](./PRD.md), [SDD.md](./SDD.md))
- Modul form QPR — menyusul, struktur harus siap menampung

Dikonsumsi oleh **Landing Page SGA** (`Ristek-CU/sga-landing-page`, React SPA di Cloudflare
Pages, tanpa backend). FE hanya konsumen `GET` publik.

## 2. Keputusan yang sudah final (jangan dibahas ulang)

| Keputusan | Nilai |
|---|---|
| Platform | Cloudflare Workers (Hono + Drizzle + D1 + R2) |
| Nama service | `bph-cms` |
| Response wrapper | `{ success, message, statusCode, data }` / error + `errors: { field: [msg] }` — dari `@internal/shared` (superapp) |
| Status event | **dihitung server** dari `starts_at/ends_at` (Asia/Jakarta) — bukan input admin |
| Timezone | simpan & kirim ISO 8601 + offset; tampilan WIB |
| Auth | reuse service `auth` (better-auth) via service binding — JANGAN bikin tabel user sendiri |
| Opsi yang gugur | GCP (tim all-Cloudflare), "tabel di landing page" (LP statis, gak punya DB), gabung ke Advocation |

## 3. Konteks ekosistem (tiga CMS terpisah)

| CMS | Divisi | Domain | Status |
|---|---|---|---|
| CMS Advo | Advocation | Student Voice | live — `satgas.sga-cakrawala.org` |
| **CMS BPH** (repo ini) | BPH | **Event** + QPR nanti | dibangun sekarang |
| CMS Ristek | Ristek | konten LP + UKM | rencana |

FE landing page punya env per CMS: `VITE_ADVOCATION_API_URL` (live),
`VITE_BPH_API_URL` (service ini, nanti), `VITE_RISTEK_CMS_API_URL` (nanti).

## 4. Rekan repo

- `Ristek-CU/sga-landing-page` — FE konsumen. Pola fetch/cache/error-nya: `src/components/reporting/form.tsx`.
- `Ristek-CU/sga-superapp` — monorepo (gateway-api, auth, sga-profile, ukm-profile,
  packages/shared). **Pola & dependency mengikuti repo ini** (Hono, drizzle-kit, hono-openapi,
  Scalar, ApiResponse/ApiError/pagination dari `@internal/shared`).
  Referensi wrapper sudah di-copy: [reference-api-response.ts](./reference-api-response.ts).

## 5. Urutan kerja BE

Milestone M1–M6 di [SDD.md §10](./SDD.md). Ringkas:

1. M1 scaffold (Hono+Drizzle+D1, schema `events`/`event_sessions`, migrasi)
2. M2 auth guard via service binding
3. M3 CRUD event + sessions + validasi
4. M4 endpoint publik (list/detail/calendar) — status dihitung server
5. M5 upload R2 + publish/unpublish
6. M6 OpenAPI + test status + review → siap integrasi FE

## 6. Hal yang gak boleh dilanggar

- Status `ongoing/upcoming/past` dihitung server. Tidak ada kolom status manual untuk mahasiswa.
- Semua timestamp ISO 8601 dengan offset. Tampilan WIB.
- Error shape konsisten `errors: { field: [msg] }` — FE sudah mengandalkannya.
- Endpoint publik read-only, hanya `published`, draft tidak bocor (404).
- Contract SDD §4 itu final sampai didiskusikan ulang — FE sudah membangun dummy JSON darinya.

## 7. Google Calendar

Fase 1: tanpa backend — tombol FE pakai template URL resmi. GCP belum disentuh.
Fase 2 (nanti): push ke kalender publik via service account (signing JWT di Workers dengan
`jose`). Jangan dibangun sekarang.

## 8. Status repo

Repo kosong saat dokumen ini ditulis (1 Sep 2026). Langkah pertama setelah review PRD/SDD:
scaffold `apps`-style struktur atau standalone Worker repo, ikuti SDD §2.
