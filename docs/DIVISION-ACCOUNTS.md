# Division Accounts — SGA CMS Hub

**Versi:** 0.3
**Tanggal:** 11 September 2026
**Status:** 8 akun + 8 membership lengkap di production — bootstrap platform_admin sudah dimatikan

---

## Aturan

File ini adalah daftar akun per divisi. Password di bawah adalah **temporary password candidate untuk local/dev seed**, bukan password aktif yang aman untuk disimpan jangka panjang.

Untuk produksi:

- set password lewat auth service,
- kirim password lewat channel privat,
- wajibkan ganti password setelah login pertama,
- jangan commit password aktif ke repo.

> ⚠️ **Status 11 Sep 2026 — rotasi masih tertunda.** Enam akun divisi (ukm, advo, bnp,
> icd, pr, media) dibuat 10 Sep 2026 memakai pola `<slug>password123!` yang tertulis di
> file ini. Kredensial aktif masih sama dengan teks di git history. Rotasi segera setelah
> masing-masing divisi login pertama, lalu hapus kolom password dari file ini.
>
> BPH dan Ristek **tidak** terkena: kandidat password mereka di file ini ternyata tidak
> pernah aktif (diverifikasi 11 Sep 2026 — sign-in 401), password aslinya berbeda dan
> hanya diketahui pemiliknya.
>
> Rotasi mendesak karena **belum ada endpoint untuk mencabut/men-suspend membership** —
> kalau satu akun bocor, penanganannya hanya lewat edit database langsung
> (`UPDATE cms_memberships SET status='suspended' WHERE ...`).

## Perubahan dari versi 0.2 (11 Sep 2026)

- **BPH kini punya baris `cms_memberships` role `platform_admin`** — superadmin penuh.
  `user_id` diambil langsung dari `superapp-auth-db` (tabel `user`), bukan dari login.
- **Ristek kini punya baris `cms_memberships` role `division_admin`** — sebelumnya 403 di
  semua endpoint admin, hanya bisa membuka `/docs/`.
- **`PLATFORM_BOOTSTRAP_EMAILS` dikosongkan** (`""` di `wrangler.jsonc`, deploy version
  `42cd77dd`). Jalur superadmin-otomatis-tanpa-database sudah mati. Akses admin sekarang
  100% ditentukan baris `cms_memberships`.
- Total: **8 akun, 8 membership** — 1 `platform_admin` + 7 `division_admin`.

## Perubahan dari versi 0.1

- Domain akun: **`@cakrawala.com`**, bukan `@cakrawala.ac.id` seperti rencana versi 0.1.
- Konsekuensi yang belum dirapikan: kolom `divisions.email` di database masih ter-seed
  dengan `@cakrawala.ac.id` (dari `drizzle/0001_watery_skreet.sql`). Kolom itu informasional
  saja — tidak dipakai untuk keputusan auth apa pun.
- Model akun: **satu akun bersama per divisi**, bukan akun personal per pengurus.
  Konsekuensi: `audit_logs` mencatat actor sebagai akun divisi, jadi tidak bisa membedakan
  siapa di dalam divisi yang melakukan perubahan.
- Akun dibuat lewat endpoint native better-auth `POST /v1/access/sign-up/email`. Detail
  provisioning: [RUNNING-GUIDE.md §12](./RUNNING-GUIDE.md).
- Role awal akun divisi: `division_admin` di `cms_memberships`.

---

## Account List

### BPH — SUPERADMIN

- Email: `bph@cakrawala.com`
- Password: secret pemilik akun (kandidat di file ini **tidak aktif**)
- `user_id`: `01a05dd1-b695-7bc3-aaa4-779440cd1868`
- `membership_id`: `01a08f2d-9c2e-7b4f-9be0-eb3aa9d3b5d8`
- `division_id`: `01990001-0000-7000-8000-000000000001` (slug `bph`)
- Membership: `platform_admin`, `active` — dibuat 11 Sep 2026 lewat insert D1 langsung
- Dashboard: Dashboard Terpadu
- Special access: QPR, Akun & Akses, Audit Log
- Event access: **semua divisi** — `platform_admin` memegang `events.read.all`,
  `events.create.all`, `events.update.all`, `events.publish.all`, `events.delete.all`,
  plus `media.upload.all`, `qpr.manage`, `accounts.manage`, `audit.read`
  (lihat `src/shared/permissions.ts`; tidak ada permission bernama `events.manage.all`)

Ingin menambah superadmin lain? Buat user di auth service, lalu insert baris
`cms_memberships` role `platform_admin` (lewat `POST /api/v1/admin/accounts` sebagai
platform_admin yang sudah ada, atau insert D1 langsung). Tidak ada jalur lain.

### Ristek

- Email: `ristek@cakrawala.com`
- Password: `ristekpassword123!` ⚠️ rotasi (terverifikasi login 11 Sep 2026)
- `user_id`: `01a05e42-d465-7d22-bf9b-3ec30edd7a7f`
- `membership_id`: `01a08f2d-c897-79ed-830d-9997dc0d8dbd`
- `division_id`: `01990001-0000-7000-8000-000000000002` (slug `ristek`)
- Membership: `division_admin`, `active` — dibuat 11 Sep 2026 lewat insert D1 langsung
- Dashboard: Select Workspace
- Workspace option:
  - Dashboard Terpadu
  - Dashboard Ristek khusus (`https://ristek.sga-cakrawala.org` — **tidak resolve**;
    baris workspace-nya sudah `is_active = 0` di production per 10 Sep 2026, jadi tombol
    tidak muncul lagi di panel)
- Special access: bisa membuka `/docs/` + `/api/v1/openapi` (`DOCS_ALLOW_EMAILS`)
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
- Special access: redirect ke dashboard Advokasi — handoff one-time code sisi Hub sudah
  live; sisi Advokasi (`/sso`) sudah ditulis tapi **belum di-deploy** (SDD §4.5)
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

Diperbarui 11 Sep 2026 — 8 akun, 8 membership, bootstrap mati.

| Divisi | Email | Password | Role CMS | Status | Login Destination | QPR | Event |
|---|---|---|---|---|---|---|---|
| BPH | `bph@cakrawala.com` | secret pemilik (kandidat tidak aktif) | **platform_admin** | ✅ membership 11 Sep | Dashboard Terpadu | Ya | Semua divisi |
| Ristek | `ristek@cakrawala.com` | `ristekpassword123!` ⚠️ rotasi (terverifikasi) | division_admin | ✅ membership 11 Sep | Select Workspace | Tidak | Divisi Ristek |
| UKM | `ukm@cakrawala.com` | `ukmpassword123!` ⚠️ rotasi | division_admin | ✅ 10 Sep | Dashboard Terpadu | Tidak | Divisi UKM |
| Advokasi | `advo@cakrawala.com` | `advopassword123!` ⚠️ rotasi | division_admin | ✅ 10 Sep | Select Workspace | Tidak | Divisi Advokasi |
| BNP | `bnp@cakrawala.com` | `bnppassword123!` ⚠️ rotasi | division_admin | ✅ 10 Sep | Dashboard Terpadu | Tidak | Divisi BNP |
| ICD | `icd@cakrawala.com` | `icdpassword123!` ⚠️ rotasi | division_admin | ✅ 10 Sep | Dashboard Terpadu | Tidak | Divisi ICD |
| Public Relation | `pr@cakrawala.com` | `prpassword123!` ⚠️ rotasi | division_admin | ✅ 10 Sep | Dashboard Terpadu | Tidak | Divisi PR |
| Media | `media@cakrawala.com` | `mediapassword123!` ⚠️ rotasi | division_admin | ✅ 10 Sep | Dashboard Terpadu | Tidak | Divisi Media |

Verifikasi 11 Sep 2026 (query `cms_memberships` D1 production):

```
division_admin  7
platform_admin  1
```

Keenam akun divisi (10 Sep) sudah diverifikasi end-to-end: login 200, `GET /me` role
benar, `GET /admin/events` hanya event divisi sendiri, tulis event BPH 403,
`/admin/qpr|accounts|audit-logs|divisions` 403, `/api/v1/openapi` 403.

---

## Provisioning Order (status per 11 Sep 2026)

1. ✅ User dibuat di auth service (8/8 — termasuk BPH & Ristek yang sudah ada sejak awal).
2. ✅ Division record — ter-seed migration `0001_watery_skreet.sql` (8 divisi).
3. ✅ Membership user ke division — **8/8 baris** di `cms_memberships`
   (6 lewat API provisioning 10 Sep, BPH + Ristek lewat insert D1 11 Sep).
4. ✅ Role: BPH `platform_admin`, sisanya `division_admin`.
5. ✅ Permission otomatis dari `ROLE_PERMISSIONS` — tidak ada tabel permission per user.
6. ✅ `PLATFORM_BOOTSTRAP_EMAILS` dikosongkan — jalur bootstrap mati (deploy `42cd77dd`).
7. ✅ Ristek & Advokasi: workspace options ter-seed; baris Ristek `is_active = 0`.
8. ⚠️ Membership BPH/Ristek di-insert langsung ke D1 — tidak punya baris audit log
   (jejaknya di commit `7140652` dan file ini).

## Sisa pekerjaan

- **Rotasi password 6 akun divisi** setelah login pertama (kredensial masih di repo).
- Bangun endpoint suspend/revoke membership — tanpa itu tidak ada cara mencabut akses
  lewat API (saat ini: edit D1 langsung).
- Sinkronkan `divisions.email` (masih `@cakrawala.ac.id`) dengan email akun `@cakrawala.com`,
  atau biarkan dan catat bahwa kolom itu bukan email login.
- Deploy sisi `/sso` AdvocationDashboard + pasang `HANDOFF_SHARED_SECRET` agar handoff
  ke Advokasi hidup end-to-end (Phase 3 / KR6, SDD §4.5).
