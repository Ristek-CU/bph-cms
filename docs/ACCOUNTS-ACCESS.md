# Accounts & Access Plan — SGA CMS Hub

**Versi:** 0.1
**Tanggal:** 7 September 2026
**Status:** Draft rencana akun dan akses
**Terkait:** [PRD-SGA-CMS-HUB.md](./PRD-SGA-CMS-HUB.md), [SDD-SGA-CMS-HUB.md](./SDD-SGA-CMS-HUB.md), [DIVISION-ACCOUNTS.md](./DIVISION-ACCOUNTS.md), [CONTEXT.md](./CONTEXT.md)

---

## 1. Aturan Penting

Jangan simpan password aktif di repo. File ini hanya untuk rencana akun, akses, dan routing dashboard.

Daftar akun per divisi yang lebih langsung dibaca ada di [DIVISION-ACCOUNTS.md](./DIVISION-ACCOUNTS.md).

Password awal sebaiknya dibuat saat provisioning lewat service auth, lalu dikirim ke pemilik akun lewat channel privat. Setelah login pertama, user wajib ganti password.

Format temporary password yang diminta untuk akun baru:

```text
<slug-divisi>password123!
```

Contoh:

```text
advopassword123!
```

---

## 2. Akun yang Sudah Ada

| Divisi / Scope | Email | Status | Catatan Password | Akses CMS Hub |
|---|---|---|---|---|
| BPH | `bph@cakrawala.com` | Sudah ada | Sudah diset di auth service. Jangan tulis ulang di repo. | Event semua divisi jika diberi izin, QPR, Akun & Akses, Audit Log |
| Ristek | `ristek@cakrawala.com` | Sudah ada | Sudah diset di auth service. Jangan tulis ulang di repo. | Event, Dashboard Terpadu, pilihan masuk Dashboard Ristek khusus |

Catatan existing credential dari percakapan harus dianggap secret. Jangan commit password tersebut ke dokumen publik.

---

## 3. Akun Divisi yang Perlu Dibuat

Email di bawah adalah rencana awal. Domain final harus mengikuti standar auth service. Untuk konsisten dengan contoh baru, akun baru memakai `@cakrawala.ac.id`.

| Divisi | Slug | Email Rencana | Temporary Password Pattern | Status | Akses Awal |
|---|---|---|---|---|---|
| BPH | `bph` | `bph@cakrawala.com` | Existing secret | Sudah ada | Event, QPR, Akun & Akses, Audit Log |
| Ristek | `ristek` | `ristek@cakrawala.com` | Existing secret | Sudah ada | Event, Dashboard Terpadu, Dashboard Ristek khusus |
| UKM | `ukm` | `ukm@cakrawala.ac.id` | `ukmpassword123!` | Belum dibuat | Event |
| Advokasi | `advo` | `advo@cakrawala.ac.id` | `advopassword123!` | Belum dibuat | Event, Dashboard Terpadu, Dashboard Advokasi khusus |
| BNP | `bnp` | `bnp@cakrawala.ac.id` | `bnppassword123!` | Belum dibuat | Event |
| ICD | `icd` | `icd@cakrawala.ac.id` | `icdpassword123!` | Belum dibuat | Event |
| Public Relation | `pr` | `pr@cakrawala.ac.id` | `prpassword123!` | Belum dibuat | Event |
| Media | `media` | `media@cakrawala.ac.id` | `mediapassword123!` | Belum dibuat | Event |

Jika ingin nama email lebih eksplisit untuk Public Relation, alternatifnya:

```text
publicrelation@cakrawala.ac.id
```

Rekomendasi saya tetap `pr@cakrawala.ac.id` karena pendek dan umum.

---

## 4. Special Account Behavior

Beberapa akun punya lebih dari satu tujuan setelah login.

### 4.1 BPH

BPH adalah akun organisasi utama.

Setelah login, BPH langsung masuk ke Dashboard Terpadu dengan menu:

- Ringkasan
- Event
- QPR
- Akun & Akses
- Audit Log
- Pengaturan

QPR hanya muncul untuk BPH sampai ada keputusan baru.

### 4.2 Ristek

Ristek punya dashboard khusus yang sudah atau akan berjalan di service/node server sendiri.

Setelah login, tampil pilihan:

1. Masuk Dashboard Terpadu
2. Masuk Dashboard Ristek

Dashboard Terpadu dipakai untuk event lintas SGA. Dashboard Ristek khusus dipakai untuk modul Ristek sendiri, misalnya konten landing page, UKM profile, atau fitur teknis lain.

Routing yang disarankan:

```text
/select-workspace
  - SGA CMS Hub
  - Ristek Dashboard
```

### 4.3 Advokasi

Advokasi punya CMS sendiri untuk Student Voice atau modul advokasi yang sudah berjalan di luar dashboard terpadu.

Setelah login, tampil pilihan:

1. Masuk Dashboard Terpadu
2. Masuk Dashboard Advokasi

Dashboard Terpadu dipakai untuk membuat event. Dashboard Advokasi khusus tetap dipakai untuk fitur advokasi.

### 4.4 Divisi Lain

UKM, BNP, ICD, Public Relation, dan Media langsung masuk Dashboard Terpadu.

Menu awal:

- Ringkasan Divisi
- Event
- Kalender
- Media Library, jika sudah dibuat

Mereka tidak melihat QPR, Akun & Akses, atau Audit Log global.

---

## 5. Draft Permission Matrix

| Akun | Event | QPR | Akun & Akses | Audit Log | Dashboard Khusus |
|---|---|---|---|---|---|
| BPH | Semua / sesuai izin | Ya | Ya | Ya | Tidak |
| Ristek | Divisi sendiri | Tidak | Tidak | Terbatas | Dashboard Ristek |
| UKM | Divisi sendiri | Tidak | Tidak | Tidak | Tidak |
| Advokasi | Divisi sendiri | Tidak | Tidak | Terbatas | Dashboard Advokasi |
| BNP | Divisi sendiri | Tidak | Tidak | Tidak | Tidak |
| ICD | Divisi sendiri | Tidak | Tidak | Tidak | Tidak |
| Public Relation | Divisi sendiri | Tidak | Tidak | Tidak | Tidak |
| Media | Divisi sendiri | Tidak | Tidak | Tidak | Tidak |

---

## 6. Login Flow Target

### Normal Account

```text
Login -> ambil session auth -> cek membership CMS -> masuk Dashboard Terpadu
```

### Special Account

```text
Login -> ambil session auth -> cek membership CMS -> tampil Select Workspace
```

Pilihan workspace:

- Dashboard Terpadu: tetap di CMS Hub.
- Dashboard khusus: redirect ke service milik divisi.

Redirect jangan membawa password. Gunakan session/token yang aman dari auth service.

---

## 7. Provisioning Checklist

Untuk setiap akun baru:

- Buat user di auth service.
- Set temporary password sesuai format awal.
- Tandai user wajib ganti password saat login pertama.
- Buat division record jika belum ada.
- Buat membership user ke division.
- Assign role awal: `division_admin`.
- Assign permission awal: `events.read`, `events.create`, `events.update.own_division`, `events.publish.own_division`.
- Untuk BPH, tambah `qpr.manage`, `accounts.manage`, `audit.read`.
- Untuk Ristek dan Advokasi, set `special_workspace = true`.
- Catat provisioning di audit log.

---

## 8. Data yang Dibutuhkan di Backend

Minimal field user membership:

```ts
type CmsMembership = {
  user_id: string;
  division_id: string;
  role: "platform_admin" | "division_admin" | "contributor" | "viewer";
  status: "active" | "suspended";
  special_workspace?: "ristek" | "advokasi" | null;
};
```

Minimal field division:

```ts
type Division = {
  id: string;
  name: string;
  slug: string;
  email: string;
  dashboard_url?: string | null;
};
```

---

## 9. Open Questions

- Domain final akun baru pakai `@cakrawala.ac.id` atau semua disamakan ke `@cakrawala.com`?
- Public Relation pakai email `pr@...` atau `publicrelation@...`?
- BPH boleh edit event semua divisi, atau hanya lihat semua dan edit BPH saja?
- Akun divisi mau satu shared account per divisi, atau akun personal per pengurus? Rekomendasi tetap akun personal untuk audit yang benar.
- Dashboard Ristek dan Advokasi nanti redirect URL finalnya apa?
