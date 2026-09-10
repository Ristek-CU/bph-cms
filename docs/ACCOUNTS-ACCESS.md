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

### 6.1 Update 10 Sep 2026 — mekanisme handoff sudah diputuskan

Keputusan **D-A**: `AdvocationDashboard` **pindah ke auth service superapp**,
meninggalkan Auth.js v5 Credentials + tabel `User`/`PasswordResetToken` lokal.

Konsekuensinya untuk flow di atas: setelah D-A, kedua aplikasi mengakui **penerbit sesi
yang sama**, jadi "redirect ke service milik divisi" tidak lagi butuh protokol tukar
token buatan sendiri. Yang dibawa cukup referensi sesi yang aman; cookie sesi di scope
domain induk `.sga-cakrawala.org`.

> ⚠️ Kalimat di atas soal **cookie domain induk sudah dicabut** oleh koreksi SDD §4.5
> (10 Sep 2026): panel Hub menyimpan token di `localStorage` yang terisolasi per origin,
> dan backend Hub menolak cookie secara sengaja. Mekanisme yang dipakai adalah
> **one-time handoff code**, bukan cookie bersama. Lihat SDD §4.5 untuk versi yang benar.

Desain lengkap, aturan yang mengikat, dan rencana peralihan (termasuk syarat **jendela
dual-accept** supaya admin Advokasi tidak terkunci keluar): [SDD-SGA-CMS-HUB.md §4.5](./SDD-SGA-CMS-HUB.md).

**Status implementasi sisi Hub: selesai 10 Sep 2026 dan SUDAH live di production**
(commit `c485574`, CI run `34399102006` hijau, worker ter-deploy 2026-09-09T20:07Z).

> Dikoreksi 11 Sep 2026: baris ini sebelumnya menulis "belum di-deploy ke production".
> Sudah diverifikasi ulang lewat request nyata ke production:
> `POST /api/v1/admin/workspace-handoff` tanpa token → **401** (bukan 404, jadi route-nya
> ter-mount), `POST /api/v1/internal/handoff/exchange` → **503 "Handoff exchange belum
> dikonfigurasi"** (fail-closed, karena secret belum dipasang), dan tabel
> `workspace_handoffs` ada di D1 remote.

- Tabel `workspace_handoffs` + migration `0003_wide_hellcat.sql` (SDD §4.5, tugas T2) —
  **sudah ter-apply ke D1 remote**.
- `POST /api/v1/admin/workspace-handoff` — kode sekali pakai TTL 60 detik via WebCrypto;
  izin deny-by-default berdasarkan membership atas divisi pemilik workspace
  (`src/modules/handoff/handoff.route.ts`).
- `POST /api/v1/internal/handoff/exchange` — internal, wajib header `X-Handoff-Secret`
  (wrangler secret `HANDOFF_SHARED_SECRET`, tidak pernah di-commit karena repo public).
  Sekali pakai (penukaran kedua 409), kadaluarsa 410, tanpa secret 401/503.
- `GET /api/v1/me` kini mengembalikan `id` per `workspace_options`.
- Panel `App.jsx` `handleSelectWorkspace` (`panel/src/App.jsx:96-118`): untuk
  `external_dashboard` memanggil handoff dulu lalu pindah ke `redirect_to`; untuk `cms_hub`
  modal ditutup eksplisit dan jatuh ke `<Routes>`. Modal menampilkan keadaan loading dan
  pesan error bila handoff gagal.
- Self-check `src/handoff.test.ts` (24 check) ikut dijalankan `npm test` dan jadi gate CI.

Yang **belum** selesai: sisi AdvocationDashboard (route `/sso` + penukaran server-to-server)
— itu pekerjaan repo terpisah (PROMPT 3). Sampai itu selesai, memilih "Dashboard Advokasi"
mengirim user ke `/sso?code=…` yang belum ditangani Advokasi, jadi handoff belum bisa
diuji end-to-end lintas origin.

> **Dikoreksi 11 Sep 2026.** Paragraf ini sebelumnya menulis route `/sso` "belum ada".
> Keadaan sebenarnya, diverifikasi langsung:
>
> - `src/app/sso/route.ts`, `src/app/sso/error/page.tsx`, dan `src/lib/sso.ts` **sudah
>   ditulis** di working tree `AdvocationDashboard`, tapi masih **untracked** (`?? src/app/sso/`,
>   `?? src/lib/sso.ts`) — belum di-commit, belum di-push, belum di-deploy.
> - Konsisten dengan itu: `https://satgas.sga-cakrawala.org/sso` menjawab **404**, baik
>   dengan maupun tanpa `?code=`.
> - 🔴 Kalaupun di-deploy apa adanya, **handoff tetap gagal 100%** karena bug kontrak:
>   `src/lib/sso.ts:44` mem-parse respons di root, padahal Hub membalas ter-wrapper di
>   dalam `data`. Bukti dan penjelasan lengkap: [SDD-SGA-CMS-HUB.md §4.5](./SDD-SGA-CMS-HUB.md).
> - Route itu juga masih memetakan email ke baris `model User` lokal dan menerbitkan cookie
>   lewat `next-auth/jwt` — artinya **D-A belum dikerjakan**, ini jalur pemetaan sementara.

**Langkah operasional sebelum dipakai:** set `HANDOFF_SHARED_SECRET` via
`wrangler secret put` di Worker Hub **dan** secret yang sama di Worker Advokasi. Tanpa itu
endpoint exchange menolak semua pemanggil (fail closed).

⚠️ **Diverifikasi 11 Sep 2026: secret ini BELUM dipasang.** `npx wrangler secret list`
mengembalikan `[]` untuk worker `sga-superapp-bph-cms`. Jadi langkah ini masih terbuka,
dan sampai dikerjakan endpoint exchange akan terus membalas 503.

✅ Baris `Dashboard Ristek` (`https://ristek.sga-cakrawala.org`, tidak resolve) sudah
dinonaktifkan lewat `UPDATE workspace_options SET is_active = 0 …` **langsung di D1
production** (10 Sep 2026), sengaja bukan lewat migration supaya tidak memicu deploy
penuh. Karena `/api/v1/me` memfilter `is_active`, opsi mati itu tidak lagi muncul di panel.

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

Diperbarui 10 Sep 2026.

Masih terbuka:

- Domain final akun baru pakai `@cakrawala.ac.id` atau semua disamakan ke `@cakrawala.com`?
- Public Relation pakai email `pr@...` atau `publicrelation@...`?
- BPH boleh edit event semua divisi, atau hanya lihat semua dan edit BPH saja?
- Akun divisi mau satu shared account per divisi, atau akun personal per pengurus? Rekomendasi tetap akun personal untuk audit yang benar.

Sudah terjawab sebagian:

- ~~Dashboard Ristek dan Advokasi nanti redirect URL finalnya apa?~~ → URL **sudah
  ter-seed** di `workspace_options` (`drizzle/0001_watery_skreet.sql:72-76`):
  Advokasi → `https://satgas.sga-cakrawala.org` (hidup, tapi menjawab `307 → /login`),
  Ristek → `https://ristek.sga-cakrawala.org` (**tidak resolve**). Jadi yang tersisa
  bukan "URL-nya apa", tapi: dashboard Ristek mau dibangun atau barisnya
  di-nonaktifkan dulu, dan handoff sesinya belum ada (D-A, §6.1).

Bertambah dari keputusan 10 Sep 2026:

- Setelah D-A, siapa yang memetakan baris `model User` AdvocationDashboard yang sudah ada
  ke akun auth service? Ristek perlu akses ke data itu, atau Advokasi yang menyerahkan
  daftar email adminnya?
- Setelah D-A, fitur **register** dan **hapus akun** di Advokasi hilang. Pendaftaran admin
  baru lewat mana — provisioning oleh BPH di Hub, atau self-service di auth service?
- Setelah D-B, divisi mana yang dibolehkan bikin form di Hub dan mana yang tetap di
  Advokasi? Advokasi sendiri boleh pakai modul Form Hub, atau khusus Campaign Studio?
