# Running Guide — SGA CMS Hub / BPH CMS

**Versi:** 0.1
**Tanggal:** 7 September 2026
**Scope:** Cara setup, run, test, build, deploy, dan memahami dokumen utama project

---

## 1. Baca Dokumen Ini Dulu

Urutan baca untuk developer baru:

1. [CONTEXT.md](./CONTEXT.md)
2. [PRD-SGA-CMS-HUB.md](./PRD-SGA-CMS-HUB.md)
3. [SDD-SGA-CMS-HUB.md](./SDD-SGA-CMS-HUB.md)
4. [DIVISION-ACCOUNTS.md](./DIVISION-ACCOUNTS.md)
5. [PRD.md](./PRD.md)
6. [SDD.md](./SDD.md)
7. [API.md](./API.md)
8. [PANEL-UI.md](./PANEL-UI.md)

Ringkasnya:

- `PRD-SGA-CMS-HUB.md`: arah produk multi-divisi.
- `SDD-SGA-CMS-HUB.md`: desain teknis multi-divisi.
- `DIVISION-ACCOUNTS.md`: daftar akun/divisi dan akses.
- `PRD.md` + `SDD.md`: modul Student Event yang sudah berjalan.
- `API.md`: kontrak endpoint saat ini.

---

## 2. Struktur Project

```text
bph-cms/
  src/                  Backend Cloudflare Worker + Hono
  src/index.ts          Urutan middleware + mounting semua route. Juga tempat
                        securityHeaders, proxyAuth (`/api/v1/auth/*`), dan
                        serveDocs (`/docs/*`) didefinisikan inline
  src/middlewares/      admin-auth.ts, rate-limiter.ts (d1RateLimiter),
                        require-permission.ts, require-role.ts
  src/modules/accounts/ Akun & membership (khusus platform)
  src/modules/audit/    Audit log (khusus platform)
  src/modules/events/   Modul Student Event + sessions (admin & publik)
  src/modules/handoff/  SSO handoff antar dashboard (SDD §4.5)
  src/modules/me/       GET /api/v1/me — divisi, role, permission, workspace
  src/modules/media/    Upload cover ke R2 + serve /storage/*
  src/modules/openapi/  Spec OpenAPI + gate allowlist email
  src/db/               connection.ts, schema.ts (Drizzle), rate-limit.ts (counter D1)
  src/shared/           api-response, api-error, status-codes, error-handler,
                        parse-request, permissions (ROLE_PERMISSIONS)
  src/test/harness.ts   Harness Miniflare/workerd untuk suite keamanan & handoff
  drizzle/              Migration D1
  panel/                React admin panel (Vite)
  docs/                 PRD, SDD, API, running guide
```

Catatan: `requestId` dan `cors` bukan middleware lokal — dua-duanya di-import dari Hono
(`hono/request-id`, `hono/cors`).

---

## 3. Prasyarat

Butuh:

- Node.js modern
- npm
- akun Cloudflare yang punya akses Worker, D1, R2
- Wrangler login
- auth service `sga-superapp-auth` aktif atau bisa diakses sebagai service binding

Cek versi:

```bash
node --version
npm --version
npx wrangler --version
```

Login Cloudflare:

```bash
npx wrangler login
npx wrangler whoami
```

---

## 4. Install Dependency

Root backend:

```bash
npm install
```

Panel:

```bash
npm --prefix panel install
```

Catatan: script root `npm run build` juga otomatis install panel sebelum build.

CI memakai `npm ci --legacy-peer-deps`. Flag itu **mematikan auto-install peer
dependency**, jadi apa pun yang dibutuhkan sebagai peer harus dideklarasikan eksplisit di
`package.json` — kalau tidak, dia tidak terpasang di CI walaupun terpasang di mesin lokal.

### ⚠️ Dependency yang terlihat tidak terpakai tapi WAJIB ada

Jangan "merapikan" empat package ini. Semuanya punya **nol import langsung** di `src/`,
jadi grep tampak seperti dead dependency — padahal build pecah tanpa mereka:

| Package | Kenapa wajib ada |
|---|---|
| `@standard-community/standard-json` | peer **wajib** `hono-openapi`. Package itu punya `dependencies: {}` — semuanya digantungkan ke peer |
| `@standard-community/standard-openapi` | sama |
| `@hono/standard-validator` | dideklarasikan peer *optional* oleh `hono-openapi`, tapi `hono-openapi/dist/index.js:2` **static-import** dia. Tanpa package ini esbuild gagal: `Could not resolve "@hono/standard-validator"` |
| `quansync` | peer **wajib** `@standard-community/standard-json` (tidak ada di `peerDependenciesMeta` optional) dan benar-benar di-import di `dist/zod-*.js` — jalur yang dipakai repo ini. `overrides` di `package.json` memaksa versi `^1.0.0` karena package itu meminta `^0.2.11` |

Bukti empiris: menghapus `quansync` dan `@hono/standard-validator` membuat `npm test`
gagal — `typecheck` tetap hijau karena TypeScript tidak menjalankan kode itu, jadi
**jangan andalkan typecheck** untuk menilai apakah sebuah dependency boleh dihapus.
Selalu jalankan `npm ci --legacy-peer-deps && npm test && npm run build`.

Yang **benar-benar** tidak terpakai dan sudah dihapus 11 Sep 2026:
`@scalar/hono-api-reference` (diganti Swagger UI self-hosted di `panel/public/docs/`,
commit `232bc40`).

### Dependency test yang sekarang dideklarasikan

`src/test/harness.ts` meng-import `esbuild` dan `miniflare`. Sebelum 11 Sep 2026 keduanya
tidak ada di `package.json` dan hanya terpasang sebagai dependency transitif `wrangler` —
artinya bump versi wrangler bisa memecah `npm test` (gate CI sebelum deploy) tanpa satu pun
perubahan di repo ini. Keduanya sekarang di `devDependencies`. Perhatikan `miniflare`
terpin ke versi **alpha** (`5.20260831.0-alpha`) karena itu yang kompatibel dengan
harness; jangan naikkan tanpa menjalankan seluruh suite.

---

## 5. Environment & Binding

Konfigurasi utama ada di:

```text
wrangler.jsonc
```

Binding yang dipakai:

| Binding | Fungsi |
|---|---|
| `DB` | Cloudflare D1 database |
| `BUCKET` | R2 bucket untuk media |
| `AUTH_SERVICE` | service auth superapp |
| `RATE_LIMITER` | rate limit publik — **lihat catatan di bawah, binding ini tidak menegakkan limit di production** |
| `ASSETS` | static asset panel |
| `API_BASE_URL` | base URL API |
| `CORS_ORIGIN` | whitelist origin |
| `DOCS_ALLOW_EMAILS` | email yang boleh buka docs protected |
| `PLATFORM_BOOTSTRAP_EMAILS` | email yang boleh jadi `platform_admin` tanpa baris `cms_memberships`. Kosongkan (`""`) setelah membership BPH ada di database |
| `ALLOW_DEV_AUTH` | opsional, set `true` **hanya di `.dev.vars`**. Tidak cukup sendirian — lihat catatan di bawah |
| `HANDOFF_SHARED_SECRET` | **secret**, bukan `vars` — dipasang lewat `npx wrangler secret put HANDOFF_SHARED_SECRET`, jadi tidak muncul di `wrangler.jsonc`. Dipakai `POST /api/v1/internal/handoff/exchange` untuk memastikan pemanggilnya worker Advokasi. Opsional di tipe (`src/types.ts:36`); kalau absent endpoint **fail-closed** `503` |

⚠️ **Status 11 Sep 2026:** `npx wrangler secret list` untuk worker `sga-superapp-bph-cms`
mengembalikan `[]` — artinya `HANDOFF_SHARED_SECRET` **belum dipasang** di production, dan
endpoint exchange akan membalas `503 "Handoff exchange belum dikonfigurasi"` untuk semua
pemanggil. Aman (fail-closed), tapi handoff belum bisa dipakai end-to-end. Lihat
[SDD-SGA-CMS-HUB.md §4.5](./SDD-SGA-CMS-HUB.md).

### Rate limit

Penegakan limit **tidak** dilakukan oleh binding `RATE_LIMITER`. Binding itu terpasang dan
terbaca saat deploy, tetapi di production selalu membalas `success: true` — diverifikasi
10 Sep 2026: 200 request beruntun ke `/api/v1/events` menghasilkan nol 429, sementara kode
yang sama di `wrangler dev` memblokir di request ke-61. Config-nya valid dan `namespace_id`
1003 unik di akun ini, jadi ini limitasi sisi Cloudflare, bukan salah konfigurasi.

Yang benar-benar membatasi adalah counter fixed-window di D1 (`src/db/rate-limit.ts`, tabel
`rate_limits`), dipasang lewat `d1RateLimiter`:

| Endpoint | Limit |
|---|---|
| `POST /api/v1/auth/sign-in` | 20 / 15 menit per IP+email, dan 60 / 15 menit per IP |
| `POST /api/v1/auth/sign-up` | 10 / 15 menit per IP |
| `GET /api/v1/events*` (publik) | 120 / menit per IP+path |
| `POST /api/v1/internal/handoff/exchange` | 30 / 5 menit per IP |

Baris exchange ditambahkan 11 Sep 2026. Endpoint itu satu-satunya jalur mutasi yang bisa
dipanggil tanpa sesi user, dan prefix `/internal` hanya penamaan — route-nya ter-mount di
domain publik. Pertahanan utamanya tetap kode 32-byte + perbandingan secret konstan-waktu
(brute-force tidak realistis); limiter ini lapisan tambahan supaya endpoint tidak bisa
dipakai membanjiri log. Limitnya longgar karena polenya server-to-server: satu panggilan
per user pindah dashboard.

Catatan yang berlaku untuk **semua** baris di atas: header `X-RateLimit-Limit` /
`X-RateLimit-Remaining` di-set lewat `c.header()` sebelum limiter melempar `ApiError`,
jadi pada respons **429 header itu tidak ikut terkirim** — `onError` membangun respons
baru. Header-nya hanya muncul di respons yang lolos. Ini perilaku lama, bukan regresi.

Limit publik sengaja 120, bukan 60 seperti kontrak lama, supaya banyak user di satu NAT
kampus tidak saling mengunci. Binding `RATE_LIMITER` tetap dipertahankan sebagai lapisan
murah dan punya `skip` guard agar tidak melempar TypeError saat binding absen (mis. di test).

Verifikasi limit jangan dilakukan dari `wrangler dev` — selalu tembak production melewati
batas dan pastikan muncul 429.

### Dev auth fallback

`ALLOW_DEV_AUTH=true` **tidak lagi cukup sendirian**. Sejak 10 Sep 2026 dev-auth butuh dua
syarat sekaligus: var-nya `true` **dan** request benar-benar datang lewat hostname lokal
(`localhost`, `127.0.0.1`, `[::1]`). Worker production hanya menerima trafik dari hostname
publik, jadi var yang keliru ter-set di dashboard Cloudflare tidak lagi membuka
`platform_admin` untuk siapa pun yang mengirim `Bearer dev-apa-saja`.

Karena `wrangler dev` membaca `vars` dari `wrangler.jsonc`, taruh flag ini di `.dev.vars`
(tidak ikut terdeploy):

```text
ALLOW_DEV_AUTH = "true"
```

Kalau `npm run dev` gagal dengan pesan remote session could not be authenticated, jalankan:

```bash
npx wrangler whoami
npx wrangler login
```

Kalau `AUTH_SERVICE` tampil `[not connected]` di local dev, endpoint admin/login bisa gagal. Endpoint publik dan build tetap bisa dites, tetapi login admin perlu auth service lokal/remote yang benar.

Untuk local dev sementara, set `ALLOW_DEV_AUTH=true` di `.dev.vars` agar token `dev-token`
diterima sebagai BPH bootstrap. Sejak 10 Sep 2026 flag ini **hanya berlaku untuk request
yang datang lewat hostname lokal**, jadi menyalakannya di production tidak lagi membuka
apa pun. Lihat bagian "Dev auth fallback" di atas.

---

## 6. Database

Generate migration dari schema Drizzle:

```bash
npm run db:generate
```

Apply migration lokal:

```bash
npm run db:migrate:local
```

Apply migration remote:

```bash
npm run db:migrate:remote
```

Untuk arah multi-divisi, migration baru harus mengikuti [SDD-SGA-CMS-HUB.md](./SDD-SGA-CMS-HUB.md).

Delapan tabel aplikasi yang ada di D1 production saat ini (dikonfirmasi 11 Sep 2026 lewat
`sqlite_master`):

| Tabel | Migration | Isi |
|---|---|---|
| `events` | `0000` | Modul Student Event |
| `event_sessions` | `0000` | Runsheet per event |
| `divisions` | `0001` | 8 divisi ter-seed |
| `cms_memberships` | `0001` | user ↔ divisi ↔ role. **6 baris aktif** per 11 Sep 2026 |
| `workspace_options` | `0001` | Pilihan dashboard di panel. Baris `Dashboard Ristek` sudah `is_active = 0` |
| `audit_logs` | `0001` | Jejak aksi admin |
| `rate_limits` | `0002` | Counter fixed-window — ini yang benar-benar menegakkan limit |
| `workspace_handoffs` | `0003` | Kode SSO sekali pakai (SDD §4.5) |

Kolom ownership (`division_id`, `created_by_user_id`, `updated_by_user_id`, `*_ms`) di
`events` / `event_sessions` juga dari `0001`.

⚠️ `workspace_handoffs` dideklarasikan di `src/db/schema.ts:63` dan tabelnya ada di
D1, tetapi **tidak pernah di-query lewat Drizzle** — `src/modules/handoff/handoff.route.ts`
memakai raw `c.env.DB.prepare(...)` karena butuh perbandingan leksikografis `expires_at`
dan `used_at IS NULL` yang lebih bersih ditulis sebagai SQL. Bukan bug, tapi jangan cari
query-nya di Drizzle.

---

## 7. Run Development

Run Worker + assets:

```bash
npm run dev
```

Default:

```text
http://localhost:8791
```

API:

```text
http://localhost:8791/api/v1
```

Panel:

```text
http://localhost:8791
```

Docs:

```text
http://localhost:8791/docs/
```

OpenAPI:

```text
http://localhost:8791/api/v1/openapi
```

Catatan: `/api/v1/openapi` dilindungi Bearer token dan email allowlist.

---

## 8. Run Panel Saja

Kalau ingin kerja di React panel:

```bash
npm --prefix panel run dev
```

Default Vite:

```text
http://localhost:5173
```

Vite proxy mengarah ke Worker:

```text
/api/v1 -> http://localhost:8791
```

Jadi biasanya jalankan dua terminal:

```bash
npm run dev
npm --prefix panel run dev
```

---

## 9. Test & Check

Semua test (status event + suite keamanan + handoff):

```bash
npm test
```

`npm test` menjalankan **tiga** file berurutan (total **192 check**):

| File | Isi |
|---|---|
| `src/modules/events/status.test.ts` | 9 self-check `computeStatus` (pure function) |
| `src/security.test.ts` | 155 check keamanan — menjalankan **Worker asli** di Miniflare/workerd dengan D1 + R2 nyata dan `AUTH_SERVICE` di-stub |
| `src/handoff.test.ts` | 28 check SSO handoff (SDD §4.5) — pakai harness yang sama, dengan `HANDOFF_SHARED_SECRET` di-set lewat `vars` |

Suite keamanan menutup matriks yang dulu tidak punya test sama sekali: autentikasi,
isolasi lintas divisi (read/update/delete/publish/sesi), contributor draft-only, viewer
read-only, endpoint khusus `platform_admin` (QPR/akun/audit), gate docs, draft tidak bocor
ke endpoint publik, validasi input, redaksi pesan error internal, header keamanan, CORS,
upload R2, proxy auth, dan titik blokir rate limit.

Suite handoff menutup: izin deny-by-default per membership divisi pemilik workspace,
entropi kode, `redirect_to` hanya membawa param `code` (tidak pernah token/session),
sekali pakai (penukaran kedua 409), kadaluarsa 410, tanpa/salah secret 401, cleanup kode
lama, filter `is_active` di `/api/v1/me`, dan **titik blokir rate limit exchange** (429
persis di request ke-31, plus bukti counter D1-nya — bukan cuma dilihat dari config).

Harness ada di `src/test/harness.ts`. Catatan bila mengubahnya:

- `@ts-nocheck` di harness disengaja — tsconfig repo ini `types: ["@cloudflare/workers-types"]`
  tanpa tipe Node, dan `Headers` versi undici bentrok dengan versi workers-types.
- Bundle ditulis ke `node_modules/.cache/bph-cms-test/worker.mjs`. workerd menolak
  `scriptPath` di luar root project, jadi jangan pindah ke `/tmp`.
- Miniflare v5 alpha butuh `convertV4MiniflareOptions`, plain var lewat `bindings`
  (bukan `vars`), dan menolak header `Origin` ber-hostname non-localhost.
- Binding `RATE_LIMITER` tidak didukung Miniflare. Test rate limit mengandalkan
  `d1RateLimiter`, dan window-nya disejajarkan dulu lewat `awaitWindowHeadroom` supaya
  tidak flaky saat loop kebetulan melintasi batas window.

Typecheck backend:

```bash
npm run typecheck
```

Build panel:

```bash
npm --prefix panel run build
```

Build project dari root:

```bash
npm run build
```

Whitespace/diff check sebelum commit:

```bash
git diff --check
git status --short
```

---

## 10. Smoke Test API

Public health:

```bash
curl http://localhost:8791/api/v1
```

Public event list:

```bash
curl http://localhost:8791/api/v1/events
```

Public calendar:

```bash
curl "http://localhost:8791/api/v1/events/calendar?month=2026-09"
```

Admin endpoints butuh token:

```bash
curl http://localhost:8791/api/v1/admin/events \
  -H "Authorization: Bearer <token>"
```

---

## 11. Deploy

**Push ke `main` = deploy production otomatis.** `.github/workflows/deploy.yml` menjalankan
typecheck → test → build panel → `wrangler d1 migrations apply --remote` → `wrangler deploy`.
Sejak 10 Sep 2026 typecheck dan test jadi **gate**: kalau merah, migration dan deploy tidak
jalan. Jadi `npm test` yang gagal berarti production tidak tersentuh.

Deploy manual (kalau perlu, urutannya harus sama):

```bash
npm run build
```

Apply remote migrations jika ada:

```bash
npm run db:migrate:remote
```

Deploy Worker:

```bash
npm run deploy
```

Sebelum migration remote, ambil restore point:

```bash
npx wrangler d1 export bph-cms-db --remote \
  --output backups/pre-<nama-perubahan>-<tanggal>.sql --skip-confirmation
```

`backups/` sudah di-gitignore — jangan pernah commit dump production.

Setelah deploy, cek:

```text
https://bph-cms.sga-cakrawala.org/api/v1
https://bph-cms.sga-cakrawala.org/api/v1/events
https://bph-cms.sga-cakrawala.org/docs/
```

Jangan berhenti di "endpoint hidup". Untuk perubahan yang menyentuh auth/permission/rate
limit, verifikasi juga dengan request nyata: admin tanpa token → 401, akun divisi A tidak
bisa menyentuh event divisi B → 403, dan tembak endpoint melewati batas limit sampai muncul
429. Binding yang terbaca di `wrangler deploy` bukan bukti sebuah kontrol benar-benar
menegakkan apa pun.

---

## 12. Account Provisioning

Daftar akun/divisi ada di:

```text
docs/DIVISION-ACCOUNTS.md
```

Aturan:

- password produksi jangan disimpan di repo,
- akun dibuat lewat auth service,
- membership dibuat di CMS Hub,
- permission diberikan sesuai role,
- BPH dapat QPR,
- Ristek dan Advokasi dapat Select Workspace,
- semua divisi dapat Event.

### Jalur yang benar-benar berfungsi (dipetakan 10 Sep 2026)

Service auth yang terdeploy me-mount routernya di `/v1/access/*`, bukan `/v1/auth/*` seperti
di source repo superapp. Hasil pemetaan lewat service binding:

| Path di auth service | Status |
|---|---|
| `POST /v1/access/sign-in` | hidup (authRouter, respons ter-wrapper) |
| `GET /v1/access/session` | hidup |
| `POST /v1/access/sign-out` | hidup |
| `POST /v1/access/sign-up` | **404 kosong** — authRouter yang terdeploy tidak punya sign-up |
| `POST /v1/access/sign-up/email` | hidup (endpoint native better-auth, respons polos `{ token, user }`) |

Jadi user baru dibuat lewat endpoint native. Proxy `POST /api/v1/auth/sign-up` di repo ini
sudah diarahkan ke sana dan membungkus ulang responsnya supaya bentuknya sama dengan
sign-in.

Langkah provisioning satu divisi:

1. Buat user: `POST /api/v1/auth/sign-up` dengan `{ name, email, password }`
   (`requireEmailVerification: false` di auth service, jadi akun langsung aktif).
2. Catat `data.user.id` dari respons — ini yang dipakai sebagai `user_id`.
3. Buat membership di D1. Bisa lewat `POST /api/v1/admin/accounts` dengan token
   `platform_admin`, atau langsung:

   ```bash
   npx wrangler d1 execute bph-cms-db --remote --command "INSERT INTO cms_memberships
     (id, user_id, user_email, division_id, role, status, created_at, updated_at)
     VALUES ('<uuidv7>','<user_id>','<email>','<division_id>','division_admin','active',
             '<iso>','<iso>');"
   ```

4. Verifikasi: login, lalu `GET /api/v1/me` harus menampilkan divisi + role + permission
   yang benar, `GET /api/v1/admin/events` hanya berisi event divisi itu, dan
   `/admin/qpr` → 403.

Tanpa langkah 3 akun **tidak punya akses apa pun**: user baru dapat role `user` di auth
service, dan `ROLE_PERMISSIONS` CMS Hub dibaca dari `cms_memberships`, bukan dari role
auth service.

⚠️ Belum ada endpoint untuk mencabut atau men-suspend membership. Revokasi sementara hanya
bisa lewat update `status = 'suspended'` langsung di database.

---

## 13. Development Order Multi-Divisi

Urutan implementasi yang disarankan:

1. Buat schema `divisions`, `cms_memberships`, `workspace_options`, `audit_logs`.
2. Seed semua divisi dari [DIVISION-ACCOUNTS.md](./DIVISION-ACCOUNTS.md).
3. Tambah ownership `division_id` di `events`.
4. Tambah `/api/v1/me`.
5. Tambah `loadMembership` middleware.
6. Tambah `requirePermission`.
7. Scope admin event list dan mutations berdasarkan divisi.
8. Tambah feature gate sidebar panel.
9. Tambah Select Workspace untuk Ristek dan Advokasi.
10. Tambah Account & Access page untuk BPH.
11. Baru lanjut QPR.

---

## 14. Troubleshooting

### Wrangler Remote Auth Error

Gejala:

```text
remote session could not be authenticated
```

Solusi:

```bash
npx wrangler whoami
npx wrangler login
```

### AUTH_SERVICE Not Connected

Gejala:

```text
AUTH_SERVICE ... local [not connected]
```

Dampak:

- login admin gagal,
- admin endpoints gagal,
- public endpoints masih bisa dites.

Solusi:

- jalankan auth worker lokal, atau
- set binding agar memakai remote service sesuai konfigurasi Cloudflare.

Untuk local dev sementara, set `ALLOW_DEV_AUTH=true` di `.dev.vars` agar token `dev-token`
diterima sebagai BPH bootstrap. Sejak 10 Sep 2026 flag ini **hanya berlaku untuk request
yang datang lewat hostname lokal**, jadi menyalakannya di production tidak lagi membuka
apa pun. Lihat bagian "Dev auth fallback" di atas.

### Panel Request 401

Solusi:

- hapus token dari localStorage,
- login ulang,
- pastikan user punya membership dan permission.

### Event Tidak Muncul di Public API

Cek:

- event sudah `published`,
- waktu ISO valid,
- `division_id` valid setelah multi-divisi aktif,
- endpoint publik tidak memfilter division yang salah.

---

## 15. Definition of Done

Perubahan dianggap siap jika:

- `npm test` hijau,
- `npm run typecheck` hijau,
- `npm run build` hijau,
- `git diff --check` bersih,
- API contract sesuai [API.md](./API.md),
- permission sensitive dicek di backend,
- dokumen terkait diperbarui.
