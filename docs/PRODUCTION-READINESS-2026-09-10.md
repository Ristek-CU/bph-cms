# Production Readiness Report — Security Hardening + Provisioning Akun Divisi

**Tanggal:** 10 September 2026
**Domain production:** `https://bph-cms.sga-cakrawala.org`
**Worker:** `sga-superapp-bph-cms`
**Menggantikan klaim keamanan di:** [PRODUCTION-READINESS-2026-09-09.md](./PRODUCTION-READINESS-2026-09-09.md)
**Commit terkait:** `1e9f2b7` (perbaikan keamanan + test) dan commit laporan ini (proxy sign-up + docs)

---

## 1. Ringkasan

Audit keamanan dilakukan dengan **request nyata ke production**, bukan dengan membaca config
atau mengandalkan `wrangler dev`. Hasilnya: beberapa kontrol yang sebelumnya dilaporkan aktif
ternyata tidak menegakkan apa pun.

Yang dikerjakan:

1. Memperbaiki 11 celah/kelemahan (bagian 3).
2. Membangun suite test keamanan dari nol — sebelumnya hanya ada 9 assert untuk satu pure
   function, dan **nol** coverage untuk logika otorisasi (bagian 4).
3. Menjadikan typecheck + test sebagai gate CI sebelum migration dan deploy (bagian 5).
4. Provisioning 6 akun divisi + membership, lalu memverifikasi isolasinya di production
   (bagian 6).
5. Mengoreksi dokumentasi yang tidak akurat (bagian 8).

**Prinsip yang dipakai di laporan ini:** sebuah kontrol keamanan dihitung "aktif" hanya kalau
sudah dilihat menolak request nyata di production. Binding yang terbaca di `wrangler deploy`
bukan bukti.

---

## 2. Restore point

Official D1 export **berhasil** (percobaan 9 Sep gagal dengan `Authentication error [code: 10000]`):

```bash
npx wrangler d1 export bph-cms-db --remote \
  --output backups/pre-rate-limit-2026-09-10.sql --skip-confirmation
```

Isi: 6 tabel (`divisions`, `cms_memberships`, `workspace_options`, `audit_logs`, `events`,
`event_sessions`) + 19 statement INSERT. Diambil **sebelum** migration `0002` dan sebelum
insert membership. `backups/` di-gitignore — dump production tidak boleh masuk repo.

Ini menutup risiko terbuka §6 dan §9 di laporan 9 Sep.

---

## 3. Celah yang ditemukan dan diperbaiki

### 3.1 Rate limiter publik tidak menegakkan limit — TINGGI

**Bukti sebelum perbaikan:** 200 request beruntun ke `/api/v1/events` → **nol 429**.
Kode yang persis sama di `wrangler dev` → 429 mulai request ke-61.

**Bukan salah konfigurasi.** Sudah dipastikan:

- Config valid terhadap schema wrangler 4.128. Schema `ratelimits` hanya mengizinkan
  `name`, `namespace_id`, `simple` — field `remote = true` yang dipakai
  `sga-superapp/apps/gateway-api` bahkan **tidak ada** di schema versi ini.
- `namespace_id` 1003 unik di akun ini (gateway-api memakai 1001 dan 1002).
- Binding benar-benar terdeploy: `wrangler deploy --dry-run` menampilkan
  `env.RATE_LIMITER (60 requests/60s)  Rate Limit`.
- Akun paid (R2 aktif dan menyajikan objek).

Kesimpulan: penegakan tidak terjadi di sisi Cloudflare, kemungkinan limitasi plan pada Rate
Limiting API. Tidak bisa diperbaiki dari kode atau config repo ini.

**Perbaikan:** penegakan dipindah ke counter fixed-window di D1
(`src/db/rate-limit.ts`, tabel `rate_limits`, migration `0002_condemned_stone_men.sql`).
Binding `RATE_LIMITER` tetap dipasang sebagai lapisan murah, ditambah `skip` guard supaya
tidak melempar TypeError saat binding absen (mis. di Miniflare).

| Endpoint | Limit | Key |
|---|---|---|
| `GET /events*` | 120 / menit | IP + path |
| `POST /auth/sign-in` | 20 / 15 menit | IP + path + email |
| `POST /auth/sign-in` | 60 / 15 menit | IP + path |
| `POST /auth/sign-up` | 10 / 15 menit | IP + path |

Limit publik sengaja 120, bukan 60 seperti kontrak lama, supaya banyak user di satu NAT
kampus tidak saling mengunci.

### 3.2 `/auth/sign-in` tanpa batas — TINGGI

Sebelum perbaikan: 25 percobaan login beruntun semuanya lolos, tidak ada satu pun 429.
Brute-force password dan password spraying terbuka. Sekarang dibatasi dua lapis (lihat 3.1).

### 3.3 `errorHandler` membocorkan detail internal — TINGGI

Sebelum perbaikan, setiap error non-`ApiError` membalas `err.message` mentah ke klien dengan
status 500. Untuk error D1/Drizzle isinya memuat **nama tabel, potongan SQL, dan params query**.

Bukti yang tertangkap test:

```text
Failed query: insert into "cms_memberships" ("id","user_id","user_email","division_id",
"role","status","created_at","updated_at") values (?,?,?,?,?,?,?,?)
params: 01a08762-d192-7031-8d0d-fa2afb864f9c,u-baru,baru@example.com,01990001-…,viewer,active,…
```

**Perbaikan:** hanya `ApiError` yang pesannya keluar ke klien. Error lain dibalas
`"Internal server error"` generik; detail lengkap masuk log server bersama `requestId` untuk
korelasi. `requestId` ikut dikembalikan ke klien.

### 3.4 `/admin/accounts` dan `/admin/divisions` tanpa validasi — SEDANG

Sebelum perbaikan: `c.req.json()` mentah + cast tipe TypeScript (yang tidak memvalidasi apa
pun saat runtime).

- Kolom `role` di SQLite hanyalah TEXT, jadi **nilai role apa pun bisa masuk** dan menghasilkan
  membership yang tidak bisa dibaca ulang panel.
- JSON rusak → `SyntaxError` → 500 berisi pesan parser.
- Duplikat membership / duplikat slug divisi → 500 berisi SQL (lihat 3.3).
- `division_id` tidak dicek keberadaannya.

**Perbaikan:** schema zod (`src/modules/accounts/account.schema.ts`) — `role` jadi enum
tertutup, email dan slug tervalidasi, `division_id` dicek benar-benar ada di `divisions`,
JSON rusak → 400, duplikat → 409. Helper `parseJson`/`parseParams` diangkat ke
`src/shared/parse-request.ts` supaya dipakai bersama.

### 3.5 Dev-auth fallback cukup satu flag — SEDANG

Sebelum perbaikan: `ALLOW_DEV_AUTH=true` saja sudah membuat **siapa pun** yang mengirim
`Bearer dev-apa-saja` mendapat `userId` tetap + email `bph@cakrawala.com` + role `admin`,
yang lewat jalur bootstrap menjadi `platform_admin` penuh.

Status saat diaudit: var ini **tidak aktif** di production (diverifikasi — `Bearer dev-token`
→ 401). Jadi ini bukan celah yang sedang terbuka, melainkan satu setelan dashboard yang
keliru dari bencana.

**Perbaikan:** butuh dua syarat sekaligus — var `true` **dan** request datang lewat hostname
lokal (`localhost`, `127.0.0.1`, `[::1]`). Worker production hanya menerima trafik dari
hostname publik, jadi flag yang ter-set di production tidak lagi berpengaruh.

### 3.6 AdminAuth menerima Cookie — SEDANG

Sebelum perbaikan: `Cookie` header diterima dan diteruskan ke auth service sebagai alternatif
Bearer. Tidak ada satu pun klien yang memakainya (panel dan halaman docs dua-duanya memakai
`Authorization: Bearer` dari localStorage — diverifikasi dengan grep), jadi ini murni
menambah permukaan CSRF.

**Perbaikan:** hanya `Authorization: Bearer` yang diterima.

### 3.7 Email bootstrap di-hardcode — SELESAI (11 Sep 2026)

Jalur bootstrap membandingkan `userEmail` dengan literal `"bph@cakrawala.com"` di dalam kode.

**Perbaikan:** dibaca dari var `PLATFORM_BOOTSTRAP_EMAILS` (koma-separator) supaya bisa
dicabut tanpa mengubah dan men-deploy kode. ~~Default dipertahankan sama karena
`cms_memberships` production belum punya baris untuk BPH~~ — **11 Sep 2026: BPH dan Ristek
punya baris membership, var dikosongkan + di-deploy (version `42cd77dd`). Jalur bootstrap
mati; satu-satunya risikonya sudah hilang.**

### 3.8 Tidak ada header keamanan — SEDANG

Sebelum perbaikan: nol header keamanan pada respons Worker.

**Perbaikan:** semua respons yang dihasilkan Worker kini membawa `X-Content-Type-Options:
nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, dan
`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'`.

**Batas yang perlu diketahui:** HTML panel dan `/docs/` disajikan **Cloudflare Assets
langsung**, tidak melewati Worker, jadi header ini tidak menempel di sana. Diverifikasi:
`GET /` dan `GET /docs/` tetap 200 tanpa CSP dan panel berfungsi normal. Memberi CSP ke panel
butuh `assets.run_worker_first`, yang mengubah urutan routing SPA — sengaja tidak dilakukan
di perubahan ini (lihat bagian 7).

### 3.9 CORS tidak mengizinkan `X-Division-Id` — SEDANG

`adminAuth` membaca `X-Division-Id` untuk memilih divisi aktif, tetapi header itu tidak ada
di `allowHeaders`. Untuk klien lintas-origin, preflight akan menolaknya — fitur pindah divisi
tidak bisa dipakai dari origin lain. Sudah ditambahkan dan diverifikasi lewat preflight nyata.

### 3.10 `listAdmin` membaca semua sesi lintas divisi — RENDAH

Query sesi tidak punya filter, jadi setiap list admin membaca **seluruh** baris
`event_sessions` dari semua divisi lalu membuang yang tidak cocok di memori. Diperbaiki
dengan `inArray` pada id event yang ada di scope.

### 3.11 Kegagalan audit log ditelan diam-dalam — RENDAH

`recordAuditLog` membungkus insert dengan `catch {}` kosong. Jejak audit yang hilang tidak
meninggalkan tanda apa pun. Sekarang kegagalannya dicatat ke log server (request utama tetap
tidak diblokir).

### Yang diaudit dan ternyata BUKAN celah

Dicatat supaya tidak "diperbaiki" lagi berdasarkan asumsi:

- **Urutan gate `/openapi`.** Kode lama memanggil `await adminAuth(c, next)` lalu memeriksa
  allowlist **sesudah** handler berjalan. Diuji langsung: hasilnya tetap **403** dan spec tidak
  bocor — Hono mengganti respons lewat `onError`. Tetap dirapikan agar allowlist diperiksa
  sebelum spec dibuat (lebih murah dan tidak bergantung pada perilaku `onError`), tapi ini
  bukan kebocoran.
- **Path traversal `/storage/*`.** R2 bukan filesystem; key diperlakukan literal, jadi `..`
  tidak menembus apa pun. Upload juga dibatasi MIME JPG/PNG/WebP dan nama file diganti uuidv7.
- **Stored XSS lewat media.** `Content-Type` yang disimpan selalu salah satu dari tiga nilai
  yang diizinkan; SVG ditolak. Diverifikasi di test.
- **`X-Division-Id` sebagai vektor eskalasi.** Header hanya memilih di antara membership yang
  benar-benar dimiliki user; nilai asing diabaikan (fallback ke membership pertama). Diverifikasi
  di test dan di production.

---

## 4. Test

Sebelum: `npm test` = 9 assert untuk `computeStatus` (pure function). **Nol** coverage untuk
autentikasi, permission, isolasi divisi, validasi, dan rate limit — yaitu semua bagian yang
menentukan aman atau tidaknya sistem multi-divisi.

Sesudah: **155 check keamanan + 9 check status**.

`src/security.test.ts` menjalankan **Worker asli** (`src/index.ts` di-bundle esbuild) di dalam
Miniflare/workerd dengan **D1 dan R2 nyata** dan `AUTH_SERVICE` di-stub lewat service binding.
Schema dan seed diambil dari file migration yang sama dengan yang jalan di production, jadi
test memakai 8 divisi asli dan id asli.

Stub `AUTH_SERVICE` dibuat meniru kondisi production yang sebenarnya (dipetakan 10 Sep 2026),
termasuk fakta bahwa `/v1/access/sign-up` membalas 404 kosong sedangkan
`/v1/access/sign-up/email` hidup — supaya regresi proxy tidak lolos lagi.

Cakupan:

| Area | Yang diuji |
|---|---|
| Autentikasi | 14 endpoint admin tanpa token → 401; token sampah; tanpa skema `Bearer`; **cookie saja → 401** |
| Dev-auth | flag unset → 401; flag `true` + host non-lokal → **401**; flag `true` + localhost → 200 |
| Bootstrap | `bph@` tanpa membership → `platform_admin`; email lain tanpa membership → 403 di semua endpoint admin |
| **Isolasi lintas divisi** | list hanya divisi sendiri; update/delete/publish/tambah-sesi ke event divisi lain → 403; **update/delete sesi milik event divisi lain → 403**; `X-Division-Id` asing diabaikan; `platform_admin` boleh lintas divisi |
| Contributor | create → 201 dan selalu `draft`; kirim `status:"published"` → tetap draft; update draft → 200; update published → 403; publish/unpublish/delete → 403 |
| Viewer | list → 200; create/update/delete/publish → 403 |
| Endpoint platform | `division_admin`/`contributor`/`viewer` → 403 untuk QPR, accounts, divisions, audit-logs; `platform_admin` → 200 |
| Gate docs | tanpa token → 401; `platform_admin` di luar allowlist → 403; email allowlist → 200 dan spec benar-benar berisi path |
| Draft publik | list/detail/kalender hanya `published`; slug draft → 404; respons publik tidak memuat `division_id` / `created_by_user_id` / `sessions` |
| Validasi | `ends_at <= starts_at`; slug bukan kebab; sesi di luar rentang; timestamp bukan ISO; URL tidak valid; tipe field salah |
| Error | JSON rusak → 400 di events/accounts/divisions; role di luar enum → 422; `division_id` tidak ada → 422; duplikat membership → 409; duplikat slug divisi → 409; **error D1 mentah → 500 generik tanpa nama tabel/SQL + `requestId`** |
| Header & CORS | nosniff, `X-Frame-Options`, `Referrer-Policy`, CSP (juga di respons 401); preflight 204 + `X-Division-Id`; origin di luar whitelist tidak dapat `Access-Control-Allow-Origin` |
| Storage R2 | HTML dan SVG ditolak; PNG diterima; objek terbaca publik dengan `Content-Type` benar + nosniff; traversal → 404; objek tidak ada → 404 |
| Proxy auth | sign-up → 200 ter-wrapper (bukan 404); body tidak lengkap → 400; body kosong → 400; sign-in meneruskan wrapper upstream |
| Rate limit | titik blokir persis: sign-in ke-21, sign-up ke-11, publik ke-121; spraying kena plafon per-IP; 429 bertahan selama window; tiap path punya counter terpisah |
| Audit log | jejak tertulis dengan actor yang benar untuk create, media upload, dan pembuatan membership |

Dua item checklist §10 laporan 9 Sep yang sebelumnya **belum pernah diverifikasi** sekarang
tertutup dan dijaga test: poin 5 (divisi non-BPH tidak bisa membuka QPR) dan poin 6 (divisi A
tidak bisa mengubah event divisi B).

Catatan harness ada di [RUNNING-GUIDE.md §9](./RUNNING-GUIDE.md) — termasuk kenapa
`@ts-nocheck` disengaja dan kenapa test rate limit perlu menyejajarkan window dulu agar tidak flaky.

---

## 5. Pipeline deploy

`.github/workflows/deploy.yml` sebelumnya: install → build panel → **migration remote** →
**deploy**. Tidak ada verifikasi apa pun; test yang ada pun tidak pernah dijalankan di CI.

Sekarang `Typecheck` dan `Test` jadi **gate sebelum** migration dan deploy. Kalau merah,
production tidak tersentuh.

Diverifikasi pada run `34390583364`: semua step hijau, dan log step Test di runner Linux
menunjukkan `all 9 status checks passed` + `all 145 security checks passed` (155 setelah
tambahan test proxy auth). Suite portabel, tidak bergantung mesin lokal.

---

## 6. Provisioning akun divisi

`cms_memberships` production **kosong** sebelum ini. Artinya seluruh matriks permission
multi-divisi tidak punya data, dan satu-satunya jalur admin adalah bootstrap email hardcoded.

### 6.1 Temuan: proxy sign-up menunjuk path yang mati

`POST /api/v1/auth/sign-up` membalas **404 kosong** di production. Penyebabnya bukan di repo
ini. Pemetaan auth service yang terdeploy lewat service binding:

| Path | Status |
|---|---|
| `POST /v1/access/sign-in` | hidup — authRouter, respons ter-wrapper |
| `GET /v1/access/session` | hidup |
| `POST /v1/access/sign-out` | hidup |
| `POST /v1/access/sign-up` | **404 kosong** — jatuh ke wildcard better-auth |
| `POST /v1/access/sign-up/email` | hidup — native better-auth, respons polos `{ token, user }` |
| apa pun di `/v1/auth/*` | 404 `404 Not Found` (Hono default) — prefix lama sudah tidak dipakai |

Catatan: source `sga-superapp/apps/auth` di disk masih me-mount router di `/v1/auth/*` dan
punya route `/sign-up`. **Repo superapp tidak sinkron dengan yang terdeploy.** Itu sebabnya
sign-up hilang: authRouter yang terdeploy tidak membawanya.

**Perbaikan di repo ini:** proxy diarahkan ke `sign-up/email`, dan respons native yang polos
dibungkus ulang jadi `{ success, message, statusCode, data: { token, user } }` supaya kontrak
publiknya sama dengan sign-in dan cocok dengan `authDataSchema` di spec OpenAPI. Error upstream
dipetakan ke `ApiError` agar bentuknya konsisten.

**Perbaikan yang harus dilakukan di repo superapp (bukan di sini):** sinkronkan
`apps/auth` dengan yang terdeploy, dan putuskan apakah `/sign-up` memang sengaja ditutup.
Selama keduanya berbeda, setiap konsumen auth service berisiko menunjuk path yang salah.

### 6.2 Akun yang dibuat

Keputusan yang dipakai (dikonfirmasi pemilik repo): password pola `<slug>password123!`,
satu akun bersama per divisi, domain **`@cakrawala.com`**, langsung ke production.

6 user dibuat di auth service lewat endpoint native, lalu 6 baris `cms_memberships`
diinsert ke D1 remote dengan role `division_admin`:

| Divisi | Email | `user_id` | `division_id` |
|---|---|---|---|
| UKM | `ukm@cakrawala.com` | `01a08790-eb25-72ae-9ad3-f634e5bf4ece` | `…003` (`ukm`) |
| Advokasi | `advo@cakrawala.com` | `01a08793-4617-7176-a8a8-c97548e42afc` | `…004` (`advo`) |
| BNP | `bnp@cakrawala.com` | `01a08793-47a9-753d-8132-e9eda734bc95` | `…005` (`bnp`) |
| ICD | `icd@cakrawala.com` | `01a08793-492c-79ac-871d-fe27b138141a` | `…006` (`icd`) |
| Public Relation | `pr@cakrawala.com` | `01a08793-4aad-763a-acc4-47b29e1940ec` | `…007` (`pr`) |
| Media | `media@cakrawala.com` | `01a08793-4c13-71f7-a779-aaf972195bcc` | `…008` (`media`) |

Hasil query setelah insert: 6 membership, semuanya `division_admin` / `active`, terpetakan ke
divisi yang benar, **tanpa duplikat**.

### 6.3 Verifikasi production keenam akun

Semua diuji dengan login nyata lewat API production:

| Pemeriksaan | Hasil |
|---|---|
| Login `POST /api/v1/auth/sign-in` | 200 + token (keenam akun) |
| `GET /api/v1/me` | divisi benar, role `division_admin`, permission own-division saja |
| `GET /api/v1/admin/events` | **0 event** — ketiga event production milik BPH, jadi isolasi terbaca |
| `PUT` event BPH | 403 `Forbidden: tidak memiliki akses ke event divisi ini` |
| `DELETE` event BPH | 403 |
| `POST publish` draft BPH | 403 |
| `POST` sesi ke event BPH | 403 |
| `/admin/qpr` | 403 `Forbidden: hak akses tidak mencukupi` |
| `/admin/accounts` | 403 |
| `/admin/audit-logs` | 403 |
| `/admin/divisions` | 403 |
| `/api/v1/openapi` | 403 (bukan di `DOCS_ALLOW_EMAILS`) |
| Draft BPH via endpoint publik | 404 |

Ini menutup checklist §10 poin 1, 2, 3, 5, dan 6 dari laporan 9 Sep dengan bukti nyata.

### 6.4 ⚠️ Risiko yang diterima sadar: password ada di repo

Keenam akun production memakai password yang **teksnya sudah ada di git history**
(`docs/DIVISION-ACCOUNTS.md`). Siapa pun dengan akses repo bisa login sebagai divisi mana pun.

Ini pilihan yang diambil sadar setelah risikonya disampaikan. Yang membuatnya mendesak:
**belum ada endpoint untuk mencabut atau men-suspend membership**, jadi penanganan kebocoran
hanya bisa lewat edit database langsung.

Tindakan yang disarankan, berurutan:

1. Rotasi password keenam akun segera setelah masing-masing divisi login pertama.
2. Hapus kolom password dari `DIVISION-ACCOUNTS.md` setelah rotasi.
3. Bangun endpoint suspend/revoke membership.

---

## 7. Sisa risiko & pekerjaan lanjutan

| # | Item | Kenapa belum dikerjakan |
|---|---|---|
| 1 | **Rotasi password 6 akun divisi** | Butuh login pertama tiap divisi. Lihat 6.4 — ini prioritas tertinggi. |
| ~~2~~ | ~~Membership BPH belum ada~~ **SELESAI 11 Sep 2026** — baris `platform_admin` dibuat lewat insert D1 (`user_id` dari `superapp-auth-db`), bootstrap `PLATFORM_BOOTSTRAP_EMAILS` dikosongkan + di-deploy. Commit `7140652`. |
| ~~3~~ | ~~Membership Ristek belum ada~~ **SELESAI 11 Sep 2026** — baris `division_admin`, panel bisa dipakai. |
| 4 | **Belum ada endpoint suspend/revoke membership** | Fitur baru, di luar scope perbaikan keamanan. Tanpa ini tidak ada cara mencabut akses lewat API. |
| 5 | **Panel HTML belum punya CSP / proteksi clickjacking** | Disajikan Cloudflare Assets, tidak melewati Worker. Butuh `assets.run_worker_first` yang mengubah urutan routing SPA — berisiko, perlu uji terpisah. |
| 6 | **Token disimpan di `localStorage`** | XSS pada panel = token dicuri. Tidak ada `dangerouslySetInnerHTML` di `panel/src` (diperiksa), tapi ini trade-off yang perlu diputuskan sadar. |
| 7 | **Auth service membalas email + password plaintext** saat validasi gagal: `{"data":{"email":"…","password":"salah1"}}` | Bug di `sga-superapp-auth`, bukan repo ini. `proxyAuth` meneruskannya apa adanya. |
| 8 | **Repo superapp tidak sinkron dengan auth service yang terdeploy** (`/v1/auth` vs `/v1/access`, sign-up hilang) | Perlu diperbaiki di repo superapp. Selama berbeda, konsumen lain berisiko menunjuk path mati. |
| 9 | **`divisions.email` masih `@cakrawala.ac.id`** padahal akunnya `@cakrawala.com` | Kolom informasional, tidak dipakai keputusan auth. Perlu diputuskan: disinkronkan, atau dicatat bahwa itu bukan email login. |
| 10 | ~~**Baris `Dashboard Ristek` di `workspace_options` menunjuk URL yang tidak resolve**~~ **SELESAI 10 Sep 2026** — barisnya di-set `is_active = 0`, tombol tidak muncul lagi di panel. |
| 11 | **Counter rate limit menambah 1 write D1 per request publik** | Trade-off yang diterima: tanpa ini tidak ada limit sama sekali. Pantau pemakaian write D1; kalau plan Rate Limiting API nanti aktif, lapisan D1 bisa dilonggarkan. |
| 12 | **`listAdmin` tanpa pagination** | Sudah ada catatan `ponytail` di kode. Bukan masalah keamanan; perlu sebelum event melebihi ratusan. |

---

## 8. Dokumentasi yang dikoreksi

| File | Perubahan |
|---|---|
| `RUNNING-GUIDE.md` | Tabel binding (+`PLATFORM_BOOTSTRAP_EMAILS`); bagian baru **Rate limit** dan **Dev auth fallback**; §9 Test & Check ditulis ulang (suite keamanan + catatan harness); §11 Deploy (CI gate, restore point, cara verifikasi yang benar); §12 Account Provisioning (peta path auth service yang hidup + langkah provisioning nyata) |
| `API.md` | §Auth dan §4 (izin berbasis membership + tabel scope per role, bukan "role admin"); §3.2 sign-up (200 bukan 201, penjelasan perbaikan 404); tabel error (+baris 500, catatan `requestId` dan redaksi); §7 Rate Limit ditulis ulang; Changelog 1.2 |
| `DIVISION-ACCOUNTS.md` | Versi 0.2 — status 6 akun, domain `@cakrawala.com`, `user_id`/`division_id`, hasil verifikasi, peringatan rotasi password, status BPH/Ristek, Provisioning Order diperbarui |
| `PRODUCTION-READINESS-2026-09-09.md` | Banner koreksi di atas. **Isi laporan tidak ditulis ulang** — dibiarkan sebagai catatan historis, dengan tiga klaim yang terbukti salah ditandai eksplisit |
| `PRODUCTION-READINESS-2026-09-10.md` | File ini |

Belum disentuh karena sedang diubah pemilik repo pada saat yang sama: `CONTEXT.md`,
`PRD-SGA-CMS-HUB.md`, `SDD-SGA-CMS-HUB.md`, `ACCOUNTS-ACCESS.md`. Bagian yang perlu
diselaraskan nanti: klaim rate limit 60/menit, deskripsi `ALLOW_DEV_AUTH`, dan status
provisioning akun.

---

## 9. Verifikasi setelah deploy

| Pemeriksaan | Sebelum | Sesudah |
|---|---|---|
| `/events` — 124 request beruntun | 0× 429 | **429 di request ke-121** |
| `/auth/sign-in` — percobaan beruntun | 0× 429 | **429 di percobaan ke-21** |
| `/auth/sign-up` | **404 kosong** | 200 ter-wrapper |
| Body error 500 | SQL + params query | `"Internal server error"` + `requestId` |
| Header keamanan | tidak ada | CSP, nosniff, `X-Frame-Options: DENY`, `Referrer-Policy` |
| Preflight `X-Division-Id` | ditolak | diizinkan |
| Tabel `rate_limits` remote | — | ada, terisi (12 baris saat diperiksa) |
| Login 6 akun divisi | tidak ada akunnya | 200 + membership benar |
| Isolasi divisi di production | tidak pernah diverifikasi | 403 untuk semua akses silang |
| `/`, `/events`, `/events/calendar`, detail event, gambar R2 | 200 | **200** (tidak ada regresi) |
| Admin tanpa token, `Bearer dev-token` | 401 | **401** |
| HTML panel + aset JS | 200 | **200** tanpa CSP (Assets tidak lewat Worker) |
| `npm test` | 9 check | **9 + 155 check** |
| `npm run typecheck` | hijau | hijau |
| `npm run build` | hijau | hijau, 0 vulnerability |

---

## 10. Kesimpulan

Production lebih aman secara terukur: brute-force login tertutup, rate limit benar-benar
menegakkan, pesan error internal tidak bocor, input admin tervalidasi, backdoor dev-auth butuh
dua syarat, permukaan CSRF dipersempit, dan matriks otorisasi multi-divisi sekarang dijaga 155
test yang berjalan sebagai gate CI sebelum setiap deploy.

Enam akun divisi sudah hidup dan terverifikasi terisolasi satu sama lain.

Yang **belum** aman dan paling mendesak: password keenam akun itu ada di git history dan belum
ada cara mencabut akses lewat API (bagian 6.4). Selama keduanya belum dibereskan, sistem ini
tidak boleh dianggap selesai.
