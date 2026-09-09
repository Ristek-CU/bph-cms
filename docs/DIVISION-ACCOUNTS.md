# Division Accounts — SGA CMS Hub

**Versi:** 0.1
**Tanggal:** 7 September 2026
**Status:** Draft provisioning

---

## Aturan

File ini adalah daftar rencana akun per divisi. Password di bawah adalah **temporary password candidate untuk local/dev seed**, bukan password aktif yang aman untuk disimpan jangka panjang.

Untuk produksi:

- set password lewat auth service,
- kirim password lewat channel privat,
- wajibkan ganti password setelah login pertama,
- jangan commit password aktif ke repo.

---

## Account List

### BPH

- Email: `bph@cakrawala.com`
- Password: existing secret di auth service
- Temporary reset candidate: `bphpassword123!`
- Status: sudah ada
- Dashboard: Dashboard Terpadu
- Special access: QPR, Akun & Akses, Audit Log
- Event access: semua event jika diberi permission `events.manage.all`; minimal event BPH sendiri

### Ristek

- Email: `ristek@cakrawala.com`
- Password: existing secret di auth service
- Temporary reset candidate: `ristekpassword123!`
- Status: sudah ada
- Dashboard: Select Workspace
- Workspace option:
  - Dashboard Terpadu
  - Dashboard Ristek khusus
- Special access: redirect ke dashboard Ristek
- Event access: event divisi Ristek di Dashboard Terpadu

### UKM

- Email: `ukm@cakrawala.ac.id`
- Password: `ukmpassword123!`
- Status: belum dibuat
- Dashboard: Dashboard Terpadu
- Special access: tidak ada
- Event access: event divisi UKM

### Advokasi

- Email: `advo@cakrawala.ac.id`
- Password: `advopassword123!`
- Status: belum dibuat
- Dashboard: Select Workspace
- Workspace option:
  - Dashboard Terpadu
  - Dashboard Advokasi khusus
- Special access: redirect ke dashboard Advokasi
- Event access: event divisi Advokasi di Dashboard Terpadu

### BNP

- Email: `bnp@cakrawala.ac.id`
- Password: `bnppassword123!`
- Status: belum dibuat
- Dashboard: Dashboard Terpadu
- Special access: tidak ada
- Event access: event divisi BNP

### ICD

- Email: `icd@cakrawala.ac.id`
- Password: `icdpassword123!`
- Status: belum dibuat
- Dashboard: Dashboard Terpadu
- Special access: tidak ada
- Event access: event divisi ICD

### Public Relation

- Email: `pr@cakrawala.ac.id`
- Password: `prpassword123!`
- Status: belum dibuat
- Dashboard: Dashboard Terpadu
- Special access: tidak ada
- Event access: event divisi Public Relation

Alternatif email jika ingin nama panjang:

- Email: `publicrelation@cakrawala.ac.id`
- Password: `publicrelationpassword123!`

### Media

- Email: `media@cakrawala.ac.id`
- Password: `mediapassword123!`
- Status: belum dibuat
- Dashboard: Dashboard Terpadu
- Special access: tidak ada
- Event access: event divisi Media

---

## Summary Table

| Divisi | Email | Password Candidate | Status | Login Destination | QPR | Event |
|---|---|---|---|---|---|---|
| BPH | `bph@cakrawala.com` | `bphpassword123!` | Sudah ada | Dashboard Terpadu | Ya | Ya |
| Ristek | `ristek@cakrawala.com` | `ristekpassword123!` | Sudah ada | Select Workspace | Tidak | Ya |
| UKM | `ukm@cakrawala.ac.id` | `ukmpassword123!` | Belum dibuat | Dashboard Terpadu | Tidak | Ya |
| Advokasi | `advo@cakrawala.ac.id` | `advopassword123!` | Belum dibuat | Select Workspace | Tidak | Ya |
| BNP | `bnp@cakrawala.ac.id` | `bnppassword123!` | Belum dibuat | Dashboard Terpadu | Tidak | Ya |
| ICD | `icd@cakrawala.ac.id` | `icdpassword123!` | Belum dibuat | Dashboard Terpadu | Tidak | Ya |
| Public Relation | `pr@cakrawala.ac.id` | `prpassword123!` | Belum dibuat | Dashboard Terpadu | Tidak | Ya |
| Media | `media@cakrawala.ac.id` | `mediapassword123!` | Belum dibuat | Dashboard Terpadu | Tidak | Ya |

---

## Provisioning Order

1. Pastikan user sudah ada di auth service.
2. Buat division record di CMS Hub.
3. Buat membership user ke division.
4. Assign role awal `division_admin`.
5. Assign permission event untuk divisi sendiri.
6. Untuk BPH, tambah permission QPR dan account management.
7. Untuk Ristek dan Advokasi, set workspace options.
8. Catat semua perubahan di audit log.
