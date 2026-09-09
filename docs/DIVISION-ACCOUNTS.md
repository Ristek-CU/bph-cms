# Division Accounts — SGA CMS Hub

**Versi:** 0.2
**Tanggal:** 10 September 2026
**Status:** 6 akun divisi sudah dibuat di production

---

## Aturan

File ini adalah daftar rencana akun per divisi. Password di bawah adalah **temporary password candidate untuk local/dev seed**, bukan password aktif yang aman untuk disimpan jangka panjang.

Untuk produksi:

- set password lewat auth service,
- kirim password lewat channel privat,
- wajibkan ganti password setelah login pertama,
- jangan commit password aktif ke repo.

> ⚠️ **Status 10 Sep 2026 — perlu rotasi.** Enam akun divisi di bawah **sudah dibuat di
> production memakai pola `<slug>password123!` yang tertulis di file ini**. Artinya
> kredensial aktif sekarang sama dengan teks yang sudah ada di git history dan terbaca oleh
> siapa pun yang punya akses repo. Ini keputusan yang diambil sadar, tetapi konsekuensinya
> nyata: rotasi password keenam akun segera setelah masing-masing divisi login pertama,
> lalu hapus kolom password dari file ini.
>
> Rotasi mendesak karena **belum ada endpoint untuk mencabut/men-suspend membership** —
> kalau satu akun bocor, penanganannya hanya lewat edit database langsung.

## Perubahan dari versi 0.1

- Domain akun baru diputuskan **`@cakrawala.com`**, bukan `@cakrawala.ac.id` seperti rencana
  versi 0.1 — supaya konsisten dengan BPH dan Ristek yang sudah ada.
- Konsekuensi yang belum dirapikan: kolom `divisions.email` di database masih ter-seed
  dengan `@cakrawala.ac.id` (dari `drizzle/0001_watery_skreet.sql`). Kolom itu informasional
  saja — tidak dipakai untuk keputusan auth apa pun — tapi sekarang tidak sinkron dengan
  email akun yang sebenarnya.
- Model akun: **satu akun bersama per divisi** (6 akun), bukan akun personal per pengurus.
  Konsekuensi: `audit_logs` mencatat actor sebagai akun divisi, jadi tidak bisa membedakan
  siapa di dalam divisi yang melakukan perubahan.
- Akun dibuat lewat endpoint native better-auth `POST /v1/access/sign-up/email`, karena
  authRouter service auth yang terdeploy tidak punya `/sign-up`. Detail dan langkah
  provisioning: [RUNNING-GUIDE.md §12](./RUNNING-GUIDE.md).
- Role awal semua akun divisi: `division_admin` di `cms_memberships`.

---

## Account List

### BPH

- Email: `bph@cakrawala.com`
- Password: existing secret di auth service
- Temporary reset candidate: `bphpassword123!`
- Status: user sudah ada di auth service — **belum punya baris `cms_memberships`**
- Jalur akses saat ini: bootstrap `PLATFORM_BOOTSTRAP_EMAILS` di `wrangler.jsonc`. Tanpa
  membership, user yang emailnya cocok langsung diberi `platform_admin`. Ini satu-satunya
  jalur admin yang hidup di production sekarang.
- `division_id`: `01990001-0000-7000-8000-000000000001` (slug `bph`)
- Dashboard: Dashboard Terpadu
- Special access: QPR, Akun & Akses, Audit Log
- Event access: semua divisi — `platform_admin` memegang `events.read.all`,
  `events.create.all`, `events.update.all`, `events.publish.all`, `events.delete.all`,
  plus `media.upload.all`, `qpr.manage`, `accounts.manage`, `audit.read`
  (lihat `src/shared/permissions.ts`; tidak ada permission bernama `events.manage.all`)
- Yang perlu dikerjakan: buat baris `cms_memberships` role `platform_admin` untuk akun ini,
  lalu kosongkan `PLATFORM_BOOTSTRAP_EMAILS` supaya jalur bootstrap mati. Butuh `user_id`
  dari auth service, jadi harus login sebagai BPH dulu.

### Ristek

- Email: `ristek@cakrawala.com`
- Password: existing secret di auth service
- Temporary reset candidate: `ristekpassword123!`
- Status: user sudah ada di auth service — **belum punya baris `cms_memberships`**
- Akibatnya: email ini ada di `DOCS_ALLOW_EMAILS` jadi bisa membuka `/docs/` dan
  `/api/v1/openapi`, tetapi `permissions` kosong → **403 di semua endpoint admin**, termasuk
  panel. Ristek belum bisa mengelola event sampai membership-nya dibuat.
- `division_id`: `01990001-0000-7000-8000-000000000002` (slug `ristek`)
- Dashboard: Select Workspace
- Workspace option:
  - Dashboard Terpadu
  - Dashboard Ristek khusus (`https://ristek.sga-cakrawala.org` — **tidak resolve**,
    tombolnya sudah tampil di panel production)
- Special access: redirect ke dashboard Ristek — handoff sesi belum diimplementasikan (D-A)
- Event access: event divisi Ristek di Dashboard Terpadu

### UKM

- Email: `ukm@cakrawala.com`
- Password: `ukmpassword123!` — **aktif di production, wajib rotasi**
- Status: ✅ dibuat 10 Sep 2026
- `user_id`: `01a08790-eb25-72ae-9ad3-f634e5bf4ece`
- `division_id`: `01990001-0000-7000-8000-000000000003` (slug `ukm`)
- Membership: `division_admin`, `active`
- Dashboard: Dashboard Terpadu
- Special access: tidak ada
- Event access: event divisi UKM

### Advokasi

- Email: `advo@cakrawala.com`
- Password: `advopassword123!` — **aktif di production, wajib rotasi**
- Status: ✅ dibuat 10 Sep 2026
- `user_id`: `01a08793-4617-7176-a8a8-c97548e42afc`
- `division_id`: `01990001-0000-7000-8000-000000000004` (slug `advo`)
- Membership: `division_admin`, `active`
- Dashboard: Select Workspace
- Workspace option:
  - Dashboard Terpadu
  - Dashboard Advokasi khusus (`https://satgas.sga-cakrawala.org`)
- Special access: redirect ke dashboard Advokasi — **handoff sesi belum diimplementasikan**
  (keputusan D-A, lihat [ACCOUNTS-ACCESS.md §6.1](./ACCOUNTS-ACCESS.md))
- Event access: event divisi Advokasi di Dashboard Terpadu

### BNP

- Email: `bnp@cakrawala.com`
- Password: `bnppassword123!` — **aktif di production, wajib rotasi**
- Status: ✅ dibuat 10 Sep 2026
- `user_id`: `01a08793-47a9-753d-8132-e9eda734bc95`
- `division_id`: `01990001-0000-7000-8000-000000000005` (slug `bnp`)
- Membership: `division_admin`, `active`
- Dashboard: Dashboard Terpadu
- Special access: tidak ada
- Event access: event divisi BNP

### ICD

- Email: `icd@cakrawala.com`
- Password: `icdpassword123!` — **aktif di production, wajib rotasi**
- Status: ✅ dibuat 10 Sep 2026
- `user_id`: `01a08793-492c-79ac-871d-fe27b138141a`
- `division_id`: `01990001-0000-7000-8000-000000000006` (slug `icd`)
- Membership: `division_admin`, `active`
- Dashboard: Dashboard Terpadu
- Special access: tidak ada
- Event access: event divisi ICD

### Public Relation

- Email: `pr@cakrawala.com`
- Password: `prpassword123!` — **aktif di production, wajib rotasi**
- Status: ✅ dibuat 10 Sep 2026
- `user_id`: `01a08793-4aad-763a-acc4-47b29e1940ec`
- `division_id`: `01990001-0000-7000-8000-000000000007` (slug `pr`)
- Membership: `division_admin`, `active`
- Dashboard: Dashboard Terpadu
- Special access: tidak ada
- Event access: event divisi Public Relation

Dipakai `pr@` (bukan alternatif nama panjang) sesuai rekomendasi versi 0.1. Alternatif
`publicrelation@cakrawala.com` tidak jadi dibuat.

### Media

- Email: `media@cakrawala.com`
- Password: `mediapassword123!` — **aktif di production, wajib rotasi**
- Status: ✅ dibuat 10 Sep 2026
- `user_id`: `01a08793-4c13-71f7-a779-aaf972195bcc`
- `division_id`: `01990001-0000-7000-8000-000000000008` (slug `media`)
- Membership: `division_admin`, `active`
- Dashboard: Dashboard Terpadu
- Special access: tidak ada
- Event access: event divisi Media

---

## Summary Table

Diperbarui 10 Sep 2026 setelah provisioning production.

| Divisi | Email | Password Candidate | Status | Login Destination | QPR | Event |
|---|---|---|---|---|---|---|
| BPH | `bph@cakrawala.com` | `bphpassword123!` | Sudah ada — **belum punya baris `cms_memberships`**, masuk lewat bootstrap | Dashboard Terpadu | Ya | Ya |
| Ristek | `ristek@cakrawala.com` | `ristekpassword123!` | Sudah ada — **belum punya baris `cms_memberships`** | Select Workspace | Tidak | Ya |
| UKM | `ukm@cakrawala.com` | `ukmpassword123!` | ✅ Dibuat 10 Sep 2026 + membership `division_admin` | Dashboard Terpadu | Tidak | Ya |
| Advokasi | `advo@cakrawala.com` | `advopassword123!` | ✅ Dibuat 10 Sep 2026 + membership `division_admin` | Select Workspace | Tidak | Ya |
| BNP | `bnp@cakrawala.com` | `bnppassword123!` | ✅ Dibuat 10 Sep 2026 + membership `division_admin` | Dashboard Terpadu | Tidak | Ya |
| ICD | `icd@cakrawala.com` | `icdpassword123!` | ✅ Dibuat 10 Sep 2026 + membership `division_admin` | Dashboard Terpadu | Tidak | Ya |
| Public Relation | `pr@cakrawala.com` | `prpassword123!` | ✅ Dibuat 10 Sep 2026 + membership `division_admin` | Dashboard Terpadu | Tidak | Ya |
| Media | `media@cakrawala.com` | `mediapassword123!` | ✅ Dibuat 10 Sep 2026 + membership `division_admin` | Dashboard Terpadu | Tidak | Ya |

Hasil verifikasi production setelah provisioning (keenam akun):

| Pemeriksaan | Hasil |
|---|---|
| Login lewat `POST /api/v1/auth/sign-in` | 200 + token |
| `GET /api/v1/me` | divisi benar, role `division_admin`, permission own-division saja |
| `GET /api/v1/admin/events` | 0 event (ketiga event production milik BPH) — isolasi jalan |
| `PUT`/`DELETE`/`publish`/tambah sesi ke event BPH | 403 |
| `/admin/qpr`, `/admin/accounts`, `/admin/audit-logs`, `/admin/divisions` | 403 |
| `/api/v1/openapi` | 403 (bukan di `DOCS_ALLOW_EMAILS`) |

Yang **belum** dikerjakan:

- BPH dan Ristek masih belum punya baris `cms_memberships`. BPH tetap bisa masuk lewat
  bootstrap `PLATFORM_BOOTSTRAP_EMAILS`; Ristek saat ini hanya bisa membuka docs, bukan
  panel. Keduanya butuh `user_id` dari auth service, yang hanya bisa didapat dengan login
  sebagai akun itu.
- `workspace_options` untuk Ristek dan Advokasi sudah ter-seed dari migration 0001, jadi
  Select Workspace sudah muncul tanpa langkah tambahan.

---

## Provisioning Order

Status per 10 Sep 2026 untuk 6 akun divisi baru (UKM, Advokasi, BNP, ICD, PR, Media):

1. ✅ User dibuat di auth service — lewat `POST /v1/access/sign-up/email`.
2. ✅ Division record sudah ada — ter-seed migration `0001_watery_skreet.sql` (8 divisi).
3. ✅ Membership user ke division dibuat — 6 baris di `cms_memberships`.
4. ✅ Role awal `division_admin`.
5. ✅ Permission event divisi sendiri — otomatis dari `ROLE_PERMISSIONS.division_admin`,
   tidak perlu baris terpisah. Tidak ada tabel permission per user.
6. ⬜ BPH: permission QPR + account management — sudah didapat lewat bootstrap
   `platform_admin`, tetapi **baris membership-nya belum ada**.
7. ✅ Ristek & Advokasi: workspace options — sudah ter-seed migration 0001.
   ⬜ Ristek: **membership belum dibuat**, jadi panel belum bisa diakses akun ini.
8. ✅ Tercatat di audit log — `recordAuditLog` menulis `accounts.membership_create` untuk
   membership yang dibuat lewat API. Enam membership ini diinsert langsung ke D1, jadi
   **tidak** punya baris audit; jejaknya ada di file ini dan di commit git.

Sisa pekerjaan:

- Rotasi password keenam akun divisi setelah login pertama (kredensialnya ada di repo).
- Buat membership `platform_admin` untuk BPH, lalu kosongkan `PLATFORM_BOOTSTRAP_EMAILS`.
- Buat membership untuk Ristek supaya bisa memakai panel, bukan hanya docs.
- Putuskan nasib baris `Dashboard Ristek` di `workspace_options`: dibangun, atau
  `is_active = 0` dulu supaya tombolnya tidak muncul mati.
- Sinkronkan `divisions.email` (masih `@cakrawala.ac.id`) dengan email akun yang sekarang
  `@cakrawala.com`, atau biarkan dan catat bahwa kolom itu bukan email login.
- Bangun endpoint suspend/revoke membership — tanpa itu tidak ada cara mencabut akses
  lewat API.
