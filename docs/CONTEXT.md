# CONTEXT.md — Baca Ini Sebelum Ngoding

> File ini untuk agent/developer yang baru buka repo. Baca berurutan:
> `PRD-SGA-CMS-HUB.md` → `SDD-SGA-CMS-HUB.md` → `RUNNING-GUIDE.md`
> → `DIVISION-ACCOUNTS.md` → `PRD.md` → `SDD.md`
> → sisa dokumen di folder ini.
> Semua konteks ada di sini.

## 1. Apa ini

**bph-cms** = service backend CMS SGA Cakrawala yang awalnya dibuat untuk BPH,
dan kini diarahkan menjadi **SGA CMS Hub**: dashboard terpadu multi-divisi dengan
akses per divisi/per fitur. Lihat [PRD-SGA-CMS-HUB.md](./PRD-SGA-CMS-HUB.md).

Menangani:

- **Modul Student Event** ← *yang dikerjakan sekarang* (lihat [PRD.md](./PRD.md), [SDD.md](./SDD.md))
- Modul form QPR — menyusul, struktur harus siap menampung
- Modul multi-divisi: akun, membership, permission, audit log, dan fitur masa depan

Dikonsumsi oleh **Landing Page SGA** (`Ristek-CU/sga-landing-page`, React SPA di **Cloudflare
Workers static assets** — `wrangler.jsonc` dengan `assets.directory: ./dist`; bukan Cloudflare
Pages. Tanpa backend). FE hanya konsumen `GET` publik.

> Dikoreksi 10 Sep 2026: dokumen ini sebelumnya menulis "Cloudflare Pages". Konfigurasi
> repo-nya Workers assets, dan situs live-nya `https://sga-cakrawala.org`.
> Workflow `.github/workflows/deployment.yaml` di repo itu (SSH + pm2 ke VPS) adalah
> **peninggalan yang sudah mati** — trigger-nya hanya branch `development`, yang commit
> terakhirnya 2025-10-25.

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
| **Visi terpadu** (10 Sep 2026) | Hub = **satu-satunya pintu masuk autentikasi** untuk semua divisi SGA. Teks kanonik: [PRD-SGA-CMS-HUB.md §1](./PRD-SGA-CMS-HUB.md). Blok visi yang sama diduplikasi di `sga-superapp/README.md`, `AdvocationDashboard/PRD.md`, `sga-landing-page/README.md` |
| **D-B — modul Form** (10 Sep 2026) | Hub **membangun modul Form/Campaign baru** untuk semua divisi. Campaign/Student Voice Advokasi **TIDAK dimigrasikan** dan tetap milik Advokasi. Konsekuensi diterima sadar: dua form builder dirawat bersamaan. Spek: PRD §7.2-E, SDD §3.7 & §5.4 |
| **D-A — satu identitas** (10 Sep 2026) | `AdvocationDashboard` **pindah ke auth service superapp**, meninggalkan Auth.js v5 Credentials + tabel `User`/`PasswordResetToken` lokal. Yang dibongkar hanya lapisan identitas — modul data, endpoint publik, URL/QR, dan storage Advokasi tidak disentuh. Batas lengkap: PRD §1.3, desain & rencana peralihan: SDD §4.5 |
| Handoff antar dashboard | Tidak boleh membawa token/kredensial di query string. Setelah D-A kedua app mengakui penerbit sesi yang sama, jadi cukup referensi sesi aman + cookie scope `.sga-cakrawala.org` |

## 3. Konteks ekosistem

> **Dikoreksi 10 Sep 2026.** Versi lama bagian ini menyebut "tiga CMS" dan menyatakan
> landing page punya tiga env per CMS. Keduanya tidak akurat terhadap kode yang ada.

Kondisi awal: beberapa CMS terpisah per divisi. Arah sekarang: repo ini menjadi hub
terpadu — **satu pintu masuk autentikasi** untuk semua divisi (PRD §1).

Ada **empat** permukaan admin, bukan tiga:

| Permukaan | Divisi | Domain | Identitas | Status |
|---|---|---|---|---|
| CMS Advo (`AdvocationDashboard`) | Advokasi | `satgas.sga-cakrawala.org` | ⚠️ Auth.js v5 + tabel `User` lokal — **akan diganti** ke auth service (D-A) | live |
| **CMS Hub** (repo ini) | SGA lintas divisi | `bph-cms.sga-cakrawala.org` | ✅ auth service superapp via binding `AUTH_SERVICE` | **live sejak 9 Sep 2026** |
| `sga-superapp/apps/sga-cms` | (FE admin untuk `sga-profile`) | belum ada target deploy | better-auth client | FE React/Vite, package name masih `vite-react-typescript-starter` v0.0.0, belum di-deploy |
| CMS Ristek | Ristek | `ristek.sga-cakrawala.org` — **tidak resolve** (HTTP 000, dites 10 Sep 2026) | — | rencana. URL-nya sudah ter-seed di `workspace_options` production, tapi barisnya **sudah di-set `is_active = 0`** (10 Sep 2026) jadi tidak lagi muncul di panel — lihat SDD §4.5 |

### Tumpang tindih yang belum diselesaikan

`sga-superapp/apps/sga-profile` sudah memodelkan `divisions` dan `events`, dan
`apps/sga-cms` sudah punya FE admin untuk itu (view Divisions, Events, Members, Roles,
Missions). Repo ini **juga** memodelkan `divisions` dan `events`. Hubungan final keduanya
**belum diputuskan** — jangan mengasumsikan salah satunya sumber kebenaran.

### Sumber data landing page (kenyataan, bukan rencana)

`sga-landing-page` di production memakai dua env; yang ketiga sudah ada di working tree
tapi belum tayang:

| Env | Status |
|---|---|
| `VITE_ADVOCATION_API_URL` | ✅ live di production |
| `VITE_STUDENT_VOICE_CAMPAIGN` | ✅ live di production |
| `VITE_BPH_API_URL` | 🟡 **sudah dibuat 10 Sep 2026** di `.env.example` (`https://bph-cms.sga-cakrawala.org`) — tapi **belum di-commit & belum di-deploy** |
| `VITE_RISTEK_CMS_API_URL` | ❌ tetap tidak pernah dibuat — dashboard Ristek sendiri belum eksis |

**Update 10 Sep 2026 (Phase 4 dikerjakan, belum tayang):** section event landing page
sudah diubah dari 555 baris JSX hardcoded menjadi konsumen `GET /api/v1/events` lewat
`src/lib/hub-events.ts` (Zod mirror `eventListItemSchema`, `AbortSignal`, cache 60 detik).
File-nya sekarang 371 baris. Fallback saat API gagal = notice di dalam section, halaman
tidak blank. Status & tanggal dipakai apa adanya dari server sesuai §6.

⚠️ Perubahan itu **masih di working tree** `sga-landing-page`. Bundle live
`https://sga-cakrawala.org` belum memuat `bph-cms.sga-cakrawala.org` — jadi **KR4 tertutup
di kode, belum di production**. Yang tersisa: review → commit → deploy → cek visual.

Yang **belum** disentuh: `src/lib/data/*.json` (members, missions, ukm-*) masih statis di
repo, padahal service `sga-profile` & `ukm-profile` sudah dibangun untuk data yang sama.


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
- Akses admin harus deny-by-default: menu boleh disembunyikan di panel, tapi izin wajib dicek di backend.
- Data event multi-divisi harus punya owner division; user divisi tidak boleh edit event divisi lain tanpa permission eksplisit.
- QPR hanya untuk akun BPH sampai ada keputusan baru.
- Contract SDD §4 itu final sampai didiskusikan ulang — FE sudah membangun dummy JSON darinya.

## 7. Google Calendar

Fase 1: tanpa backend — tombol FE pakai template URL resmi. GCP belum disentuh.
Fase 2 (nanti): push ke kalender publik via service account (signing JWT di Workers dengan
`jose`). Jangan dibangun sekarang.

## 8. Status repo

**M1–M6 selesai (1 Sep 2026) + hardening & dokumen panel (2 Sep 2026).** Service bph-cms
jalan: scaffold + D1/R2 provision, admin auth via `AUTH_SERVICE` binding, CRUD
event+sessions, endpoint publik (list/detail/calendar, status dihitung server,
rate limit 60 req/menit per IP+path via binding `RATE_LIMITER`), upload R2 +
publish/unpublish, OpenAPI di `/api/v1/openapi` + Scalar `/api/v1/reference`,
self-check status (`npm test`, 9 checks). Siap integrasi FE — contract SDD §4
sudah match e2e.

**Multi-divisi live di production (9 Sep 2026)** — `https://bph-cms.sga-cakrawala.org`,
worker `sga-superapp-bph-cms`. Detail: [PRODUCTION-READINESS-2026-09-09.md](./PRODUCTION-READINESS-2026-09-09.md).

**Visi CMS Terpadu disepakati (10 Sep 2026).** Dua keputusan bentuk diambil — D-B
(modul Form dibangun baru di Hub, data Advokasi tidak dimigrasi) dan D-A
(AdvocationDashboard pindah ke auth service superapp). Lihat §2 di atas,
PRD §1.2–§1.4, dan SDD §3.7 / §4.5 / §5.4.

Kodenya: **D-A sebagian sudah jalan** — sisi Hub (one-time handoff code) live 10 Sep 2026
(commit `c485574`). **D-B belum ada kodenya sama sekali** (§3.7 / §5.4 masih desain).

Diperbarui 11 Sep 2026. Dari tiga hal yang menahan visi ini, dua sudah bergeser:

1. ~~6 divisi selain BPH & Ristek belum punya akun di auth service~~ → **sudah beres
   10 Sep 2026.** 6 akun dibuat dan 6 baris `cms_memberships` `division_admin`/`active`
   ada di D1 production (dikonfirmasi ulang 11 Sep). Yang **masih** menahan Phase 2 / KR3:
   **Ristek belum punya membership** (403 di semua endpoint admin) dan **BPH masih lewat
   jalur bootstrap** `PLATFORM_BOOTSTRAP_EMAILS`, bukan baris membership. Ditambah rotasi
   password 6 akun yang teksnya masih ada di git history.
2. Landing page belum membaca Hub sama sekali → KR4 belum tercapai (Phase 4). **Kode di
   `sga-landing-page` sudah dibuat tapi belum di-commit & belum di-deploy.**
3. ~~`workspace_options` menunjuk `https://ristek.sga-cakrawala.org` yang tidak resolve~~ →
   barisnya sudah di-set `is_active = 0` di D1 production (diverifikasi ulang 11 Sep), jadi
   tidak muncul lagi di panel. Sisa: handoff ke Advokasi belum end-to-end — sisi Hub sudah
   menerbitkan kode, route `/sso` di `AdvocationDashboard` **sudah ditulis dan bug
   kontraknya sudah diperbaiki 11 Sep 2026**, tapi **masih untracked dan belum di-deploy**
   (`satgas.sga-cakrawala.org/sso` → 404), dan `HANDOFF_SHARED_SECRET` belum dipasang
   (Phase 3 / KR6). Detail dan bukti: SDD §4.5.

Dokumen perencanaan panel + modul berikutnya:

| Dokumen | Versi / status | Isi |
|---|---|---|
| [PRD-SGA-CMS-HUB.md](./PRD-SGA-CMS-HUB.md) | **v0.2, 10 Sep 2026** | Arah dashboard terpadu. **§1 = teks kanonik visi SGA CMS Terpadu** |
| [SDD-SGA-CMS-HUB.md](./SDD-SGA-CMS-HUB.md) | **v0.2, 10 Sep 2026** | Desain teknis multi-divisi + Form + SSO handoff. Bagian 🆕 masih desain |
| [API.md](./API.md) | — | **Contract lengkap semua endpoint — sumber utama untuk FE.** Belum memuat modul Form |
| [PRODUCTION-READINESS-2026-09-09.md](./PRODUCTION-READINESS-2026-09-09.md) | 9 Sep 2026 | Status deploy production multi-divisi + checklist operasional §10 |
| [RUNNING-GUIDE.md](./RUNNING-GUIDE.md) | — | Cara setup, run, test, build, deploy |
| [DIVISION-ACCOUNTS.md](./DIVISION-ACCOUNTS.md) | v0.1 draft | Daftar akun per divisi |
| [ACCOUNTS-ACCESS.md](./ACCOUNTS-ACCESS.md) | v0.1 draft | Rencana akun divisi, akses, special workspace. **§9 masih 5 open question** |
| [PANEL-UI.md](./PANEL-UI.md) | — | Spesifikasi dashboard admin |
| [QPR-PRD.md](./QPR-PRD.md) | v0.1 draft — **terblokir** | Konsep modul penilaian internal. Butuh konfirmasi BPH sebelum SDD |
| [FE-INTEGRATION.md](./FE-INTEGRATION.md) | — | Panduan konten/asset/GCal untuk tim FE landing page |

## 9. Catatan verifikasi (planning 1 Sep 2026 — lihat [PLAN.md](../PLAN.md))

- SDD §2 bilang "app baru di monorepo `apps/bph-cms`" — repo ini dibuat **standalone**.
  Dianggap final (SDD A9 opsi 1 "Workers terpisah"). Konsekuensi: `@internal/shared`
  (workspace package superapp) tidak bisa di-import dari repo lain → wrapper
  (`ApiResponse`/`ApiError`/`errorHandler`/`STATUS_CODES`) di-copy lokal ke `src/shared/`
  dari `reference-api-response.ts`. Pola file tetap meniru `apps/auth` & `apps/ukm-profile`.
- Pagination meta contract SDD §4.1 (`{ current_page, total, per_page }`) **beda** dari shape
  `buildPaginatedResult` di `@internal/shared` (`pagination: {page,limit,total,totalPages}`).
  Contract SDD yang menang — jangan pakai helper shared untuk endpoint publik.
- `ApiError.validation` di shared default 400; contract ekosistem minta **422** untuk
  validation error — dipakai 422 eksplisit.
- Asumsi SDD lain terverifikasi terhadap superapp: binding auth pola
  `gateway-api/src/middlewares/auth.ts` (call `AUTH_SERVICE /v1/auth/session`, inject
  userId/userRole); D1 + drizzle-kit `d1-http`; R2 dilayani via route `/storage/*`
  (pola ukm-profile); `uuidv7`; hono-openapi + Scalar semua sudah dipakai app lain.
- Binding `AUTH_SERVICE` arahkan ke worker `sga-superapp-auth` (satu akun Cloudflare).
