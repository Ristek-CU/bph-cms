# PRD — SGA CMS Hub: Dashboard Terpadu Multi-Divisi

**Versi:** 0.2
**Tanggal:** 10 September 2026 (v0.1: 7 September 2026)
**Status:** Arah final yang disepakati — visi, batas modul, dan mekanisme SSO sudah diputuskan
**Audience:** BPH, Ristek, seluruh divisi SGA, Backend, Frontend, UI/UX
**Dokumen terkait:** [CONTEXT.md](./CONTEXT.md), [SDD-SGA-CMS-HUB.md](./SDD-SGA-CMS-HUB.md), [RUNNING-GUIDE.md](./RUNNING-GUIDE.md), [DIVISION-ACCOUNTS.md](./DIVISION-ACCOUNTS.md), [ACCOUNTS-ACCESS.md](./ACCOUNTS-ACCESS.md), [PRD.md](./PRD.md), [PANEL-UI.md](./PANEL-UI.md), [QPR-PRD.md](./QPR-PRD.md), [API.md](./API.md)

> **§1 di bawah adalah teks kanonik visi SGA CMS Terpadu.** Blok yang sama diduplikasi di
> `sga-superapp`, `AdvocationDashboard`, dan `sga-landing-page`. Kalau salinan di repo lain
> berbeda dari §1 dokumen ini, **§1 di sini yang menang**.

---

## 1. Visi SGA CMS Terpadu

**SGA CMS Hub (`bph-cms`, `https://bph-cms.sga-cakrawala.org`) adalah satu-satunya pintu
masuk autentikasi untuk seluruh divisi SGA Cakrawala.**

Empat pilar:

1. **Satu identitas.** Semua aplikasi SGA mengakui sesi dari service `auth`
   (`sga-superapp-auth`, better-auth). Tidak ada aplikasi yang menyimpan tabel user atau
   password sendiri.
2. **Satu pintu masuk.** Pengurus divisi login di Hub. Akun dengan lebih dari satu ruang
   kerja memilih tujuan setelah login, lalu sistem melakukan **handoff sesi** — user tidak
   pernah login ulang di dashboard tujuan.
3. **Modul bersama vs modul divisi.** Event dan Form/Campaign adalah modul bersama di Hub,
   dipakai semua divisi. Sistem yang sudah hidup dan dimiliki divisi (Student Voice &
   Laporan Advokasi) **tetap milik divisi itu** — yang disatukan identitasnya, bukan
   modulnya.
4. **Self-service.** Divisi mengelola event dan form-nya sendiri tanpa melalui Ristek.
   Ristek merawat platform, bukan menjadi operator input data divisi lain.

### 1.1 Ringkasan produk

SGA CMS Hub adalah dashboard terpadu untuk semua divisi SGA. Setiap divisi punya akun
sendiri, tetapi hanya melihat fitur dan data yang memang boleh mereka akses.

Modul Event menjadi fitur bersama untuk semua divisi. Modul QPR tetap khusus BPH.
Modul **Form/Campaign** ditambahkan sebagai fitur bersama berikutnya. Ke depan, dashboard
ini bisa menampung modul lain seperti publikasi konten, dokumen, program kerja, approval,
dan laporan.

### 1.2 Keputusan bentuk (10 September 2026)

| # | Keputusan | Nilai | Alasan | Trade-off yang diterima sadar |
|---|---|---|---|---|
| **D-B** | Modul form lintas divisi | **Hub membangun modul Form baru. Student Voice / Campaign Advokasi dibiarkan hidup dan tetap milik Advokasi.** | Sistem Advokasi sudah live, sudah terintegrasi landing page, dan QR/link campaign-nya sudah tercetak & tersebar. Memindahkannya memaksa proxy URL permanen dan menyeret `POST /api/v1/reports` yang berkontrak 1:1 Laravel (dilarang diubah). | **Dua form builder dirawat bersamaan.** Campaign Advokasi tidak masuk rekap terpadu. Kemampuan builder / analytics / QR dikerjakan dua kali di dua codebase. |
| **D-A** | Handoff sesi antar dashboard | **AdvocationDashboard pindah ke auth service superapp**, menggantikan Auth.js v5 Credentials + tabel `User` / `PasswordResetToken` lokal. | Sesuai keputusan final [CONTEXT.md §2](./CONTEXT.md): reuse service `auth`, jangan bikin tabel user sendiri. Handoff jadi trivial karena kedua aplikasi mengakui penerbit sesi yang sama — tidak perlu protokol tukar token buatan sendiri. | Membongkar aplikasi yang sudah live: halaman login/register/forgot/reset password, kolom `created_by`/`updated_by`/`deleted_by` yang menyimpan **nama** user login, dan basis user admin yang sudah ada harus dipetakan ke identitas baru. |

**Kedua keputusan ini sengaja tidak digabung.** D-B menjaga modul data Advokasi tetap
utuh; D-A hanya mengganti lapisan identitasnya. Batas persisnya ada di §1.3.

### 1.3 Batas perubahan di AdvocationDashboard (akibat D-A)

| Lapisan | Status | Detail |
|---|---|---|
| Auth / identitas | 🔴 **Dibongkar** | `model User`, `model PasswordResetToken`, halaman `(auth)/*` (login, register, forgot-password, reset-password), bcryptjs, JWT Auth.js v5, rate limit login, throttle ganti password, hapus akun di settings |
| Kolom audit | 🟡 **Disesuaikan** | `created_by` / `updated_by` / `deleted_by` saat ini menyimpan **nama** user login. Sumber nama pindah ke profil dari auth service. Nilai historis yang sudah tersimpan tidak ditulis ulang |
| Modul data | 🟢 **Tidak disentuh** | `Campaign`, `CampaignField`, `Submission`, `SubmissionAnswer`, `SubmissionFile`, `Report`, `ReportFile`, `ReportAnswer`, `FormField` |
| Endpoint publik | 🟢 **Tidak disentuh** | `GET/POST /api/v1/campaigns/:slug`, `POST /api/v1/reports` (kontrak 1:1 Laravel), `GET /api/v1/reports/export` |
| URL & QR yang sudah tersebar | 🟢 **Tidak disentuh** | `satgas.sga-cakrawala.org`, `sga-cakrawala.org/student-voice/<slug>`, format legacy `?campaign=<slug>` |
| Storage | 🟢 **Tidak disentuh** | R2 binding `FILES`, bucket `satgas-reports`, route `/api/files/[...path]` |

### 1.4 Konsekuensi yang harus diakui sejak awal

D-B berarti organisasi akan punya **dua tempat membuat form** untuk waktu yang tidak
ditentukan:

- Divisi selain Advokasi → modul Form di Hub
- Advokasi → Campaign Studio di `satgas.sga-cakrawala.org`

Ini bertolak belakang dengan Objective §4 ("satu dashboard tanpa membuat banyak CMS
terpisah") dan diterima sebagai biaya untuk tidak mengganggu sistem live. Konsekuensi
yang perlu dijawab saat modul Form Hub dirancang:

- Apakah rekap/analytics Hub perlu menarik ringkasan campaign Advokasi (read-only) supaya
  BPH tetap punya satu tempat melihat partisipasi lintas divisi?
- Apakah divisi non-Advokasi boleh meminta campaign-nya dibuatkan di sistem Advokasi
  sebagai jalan pintas? Kalau ya, batasnya apa?

Keduanya **belum diputuskan** — dicatat di sini supaya tidak jadi kejutan nanti.

---


## 2. Contacts

| Nama / Tim | Peran | Catatan |
|---|---|---|
| BPH SGA | Product owner | Menentukan aturan akses, modul QPR, dan arah dashboard terpadu. |
| Ristek SGA | Engineering owner | Membangun backend, panel, deployment, dan integrasi landing page. |
| Ketua Divisi | Admin divisi | Mengelola event dan data milik divisinya masing-masing. |
| Anggota Divisi | Contributor | Bisa diberi akses terbatas, misalnya membuat draft event. |
| FE Landing Page | Konsumen API publik | Menampilkan event dan konten publik dari CMS Hub. |

---

## 3. Background

Saat ini repo ini bernama **bph-cms** dan modul yang sudah hidup adalah Student Event. Awalnya service ini hanya untuk BPH. Kebutuhan baru adalah menjadikan panel ini pusat kerja semua divisi, tetapi tetap menjaga batas akses.

Masalah yang mau diselesaikan:

- Tiap divisi butuh akun sendiri untuk mengelola event.
- Tidak semua fitur boleh muncul untuk semua divisi.
- QPR hanya boleh dipakai BPH.
- Event harus bisa dibuat semua divisi, tetapi data tiap divisi tidak boleh saling diedit sembarang.
- Ke depan, fitur akan bertambah. Struktur akses harus siap dari awal.

Praktik dari produk besar seperti Atlassian dan Microsoft mengarah ke model yang memisahkan **admin organisasi**, **admin produk/modul**, dan **akses dalam aplikasi**. OWASP juga menekankan least privilege, deny by default, dan validasi izin di setiap request. Maka desain CMS Hub harus memakai izin granular, bukan sekadar `role = admin`.

---

## 4. Objective

Tujuan utama: membuat satu dashboard SGA yang bisa dipakai banyak divisi tanpa membuat banyak CMS terpisah.

Kenapa penting:

- Pengurus tidak perlu minta Ristek setiap kali membuat event.
- Landing page bisa mengambil event dari semua divisi.
- Fitur internal sensitif seperti QPR tetap aman.
- Saat modul baru dibuat, tim tidak perlu rombak auth dari nol.

### Key Results

| KR | Target | Status 11 Sep 2026 |
|---|---|---|
| KR1 | 100% endpoint admin punya pengecekan izin berbasis role + scope divisi. | ✅ Tercapai (deploy 9 Sep 2026) |
| KR2 | Divisi non-BPH tidak melihat menu QPR dan API QPR mengembalikan 403. | ✅ Gate sudah ada; modul QPR-nya sendiri belum dibangun |
| KR3 | Semua divisi bisa membuat, mengedit, publish, dan unpublish event milik divisinya sendiri. | ⚠️ **Hampir.** 6 divisi (UKM, Advokasi, BNP, ICD, PR, Media) sudah punya akun auth **dan** baris `cms_memberships` `division_admin`/`active` — diverifikasi login + terisolasi di production (laporan 10 Sep §6.3, dikonfirmasi ulang 11 Sep: `SELECT count(*) FROM cms_memberships` = 6). BPH bisa lewat jalur bootstrap. **Ristek belum** — tidak punya membership, jadi `permissions` kosong dan 403 di semua endpoint admin termasuk panel |
| KR4 | Landing page bisa menampilkan event dari semua divisi yang sudah published. | 🟡 **Tertutup di kode, belum tayang** (10 Sep 2026). `sga-landing-page` sudah punya `src/lib/hub-events.ts` (Zod + AbortSignal + cache 60 dtk) dan `VITE_BPH_API_URL`; `sections/event/index.tsx` turun 555 → 371 baris dan sekarang fetch. **Tapi belum di-commit & belum di-deploy** — bundle live `sga-cakrawala.org` belum memuat `bph-cms.sga-cakrawala.org` |
| KR5 | Semua perubahan penting tercatat di audit log: siapa, divisi apa, aksi apa, kapan. | ✅ Tabel `audit_logs` live |
| **KR6** | **Login satu pintu: user yang memilih dashboard eksternal tidak diminta login ulang di tujuan.** | 🟡 **Sisi Hub selesai & live** (10 Sep 2026, commit `c485574`): `panel/src/App.jsx:96-118` sudah memanggil `POST /admin/workspace-handoff` dan pindah ke `redirect_to` berisi one-time code — bukan lagi `window.location.href` telanjang. **Sisi Advokasi belum ada** (route `/sso`), dan `HANDOFF_SHARED_SECRET` belum di-set jadi endpoint exchange fail-closed `503`. Belum bisa diuji end-to-end |
| **KR7** | **Setiap divisi selain Advokasi bisa membuat, membuka, dan merekap form/campaign sendiri di Hub tanpa bantuan Ristek.** | ❌ Belum ada modul Form sama sekali (`src/modules/` = accounts, audit, events, **handoff**, me, media, openapi) |

KR3, KR4, dan KR6 adalah tiga ujung yang belum sepenuhnya bertemu — tapi ketiganya sudah
jauh lebih dekat daripada seminggu lalu. Dari bawah: 6 divisi **sudah** bisa mengisi (KR3),
yang tersisa Ristek dan pemindahan BPH dari jalur bootstrap ke membership. Dari atas: situs
publik **sudah dibuat** membaca Hub tapi belum ditayangkan (KR4). Di tengah: Hub **sudah**
menerbitkan kode handoff, tinggal Advokasi yang menukarnya (KR6).

KR4 tinggal satu langkah (review → commit → deploy → cek visual). KR6 tinggal dua langkah
di repo lain (route `/sso` Advokasi + set `HANDOFF_SHARED_SECRET` di kedua Worker). Jadi
**yang paling menahan visi ini sekarang bukan kerja kode di repo ini** — KR3 butuh
membership Ristek & BPH, KR6 butuh Phase 3 di `AdvocationDashboard`.

---

## 5. Market Segments

### 5.1 Admin BPH

Job: mengatur fitur yang bersifat organisasi, seperti QPR, akun divisi, dan pengawasan event.

Kebutuhan:

- Melihat semua modul yang relevan untuk BPH.
- Mengelola QPR.
- Membuat akun baru untuk divisi lain.
- Melihat audit log dan aktivitas lintas divisi.

### 5.2 Admin Divisi

Job: mengelola event dan konten divisinya sendiri tanpa akses ke data internal divisi lain.

Kebutuhan:

- Masuk memakai akun divisi.
- Melihat dashboard divisinya sendiri.
- Membuat event, upload cover, publish event.
- Tidak terganggu menu yang tidak relevan.

### 5.3 Contributor Divisi

Job: membantu input data, tetapi tidak selalu boleh publish.

Kebutuhan:

- Membuat draft.
- Mengedit konten tertentu.
- Minta approval dari admin divisi sebelum publish.

### 5.4 Mahasiswa

Job: melihat event publik dari semua divisi di landing page.

Kebutuhan:

- Daftar event akurat.
- Kalender event gabungan.
- Detail event jelas.
- Link pendaftaran dan Google Calendar mudah dipakai.

---

## 6. Value Propositions

| Pengguna | Nilai Utama |
|---|---|
| BPH | Satu tempat untuk mengatur akses, QPR, dan aktivitas organisasi. |
| Divisi | Bisa publikasi event sendiri tanpa menunggu deploy atau minta akses BPH. |
| Ristek | Satu platform extensible, bukan banyak CMS kecil yang sulit dirawat. |
| Mahasiswa | Portal event lebih lengkap karena semua divisi bisa mengirim data. |

Yang harus lebih baik dari sistem lama:

- Tidak hardcoded di landing page.
- Tidak satu akun dipakai ramai-ramai.
- Tidak semua admin bisa mengakses semua fitur.
- Tidak ada status event manual yang bisa salah.

---

## 7. Solution

### 7.1 UX / User Flow

#### Login

1. User login.
2. Backend mengambil profil user dari service auth.
3. CMS Hub membaca membership user: divisi, role, dan permissions.
4. Panel hanya menampilkan menu yang boleh diakses user.

#### Dashboard Setelah Login

Menu berubah sesuai akun:

| Akun | Menu yang Terlihat |
|---|---|
| BPH Admin | Ringkasan, Event, QPR, Akun & Akses, Audit Log, Pengaturan |
| Divisi Admin | Ringkasan Divisi, Event, Media, Kalender |
| Contributor Divisi | Ringkasan, Draft Event, Kalender |
| Viewer | Ringkasan, Kalender read-only |

#### Membuat Akun Baru

1. BPH Admin buka **Akun & Akses**.
2. Klik **Tambah akun**.
3. Isi nama, email, divisi, role, dan modul yang boleh diakses.
4. Sistem membuat invitation atau akun via service auth.
5. User baru login dan hanya melihat fitur yang diberikan.

#### Membuat Event per Divisi

1. Divisi Admin buka Event.
2. Buat event seperti sekarang.
3. Event otomatis punya `owner_division_id`.
4. Divisi hanya bisa mengedit event miliknya.
5. Event published masuk ke API publik dan landing page.

#### QPR Khusus BPH

1. BPH Admin melihat menu QPR.
2. Divisi lain tidak melihat menu QPR.
3. Kalau divisi lain mencoba akses URL/API QPR langsung, server tetap menolak 403.

### 7.2 Key Features

#### A. Multi-Division Account

Setiap user bisa punya satu atau lebih membership:

- `division`: BPH, Ristek, Advocation, dan divisi lain.
- `role`: owner/admin/contributor/viewer.
- `status`: invited/active/suspended.

Catatan: jangan membuat auth baru. Identity tetap dari service auth superapp. CMS Hub hanya menyimpan membership dan izin aplikasi.

#### B. Permission Matrix

Akses dihitung dari kombinasi:

- role user,
- divisi user,
- modul yang diminta,
- aksi yang diminta,
- data yang disentuh.

Contoh permission:

| Permission | Arti |
|---|---|
| `events.read` | Melihat event admin sesuai scope. |
| `events.create` | Membuat event. |
| `events.update.own_division` | Mengedit event milik divisinya. |
| `events.publish.own_division` | Publish event milik divisinya. |
| `qpr.manage` | Mengelola QPR. Khusus BPH. |
| `accounts.manage` | Membuat dan mengubah akun. Khusus BPH/platform admin. |
| `audit.read` | Melihat log aktivitas. |

Default sistem: semua akses ditolak sampai ada permission yang jelas.

#### C. Feature Gate di Panel

Panel harus menyembunyikan menu yang tidak boleh diakses user.

Tetapi ini hanya untuk UX. Keamanan tetap wajib di backend.

Contoh:

- BPH melihat QPR.
- Divisi lain tidak melihat QPR.
- Contributor tidak melihat tombol Publish.
- Viewer tidak melihat tombol Create/Edit.

#### D. Event Multi-Divisi

Modul Event menjadi fitur bersama:

- setiap event punya pemilik divisi,
- list admin default hanya menampilkan event divisi user,
- BPH/platform admin bisa punya mode “lihat semua” jika diberi permission,
- endpoint publik tetap menampilkan semua event published,
- filter publik bisa ditambah: `?division=ristek`.

Field baru yang dibutuhkan:

- `division_id`
- `division_name`
- `division_slug`
- `created_by_user_id`
- `updated_by_user_id`

#### E. Form & Campaign Lintas Divisi

> **Modul bersama baru.** Diputuskan 10 Sep 2026 (D-B, §1.2). Ini kemampuan yang hari ini
> hanya dimiliki Advokasi lewat Campaign Studio; dibuka untuk semua divisi **tanpa**
> memindahkan milik Advokasi.

Job yang dilayani: divisi mana pun butuh mengumpulkan data dari mahasiswa — pendaftaran,
survei, jajak pendapat, rekrutmen terbuka, pengumpulan tugas — tanpa meminta Ristek
membikinkan, dan tanpa harus pinjam sistem Advokasi.

Kemampuan inti:

- **Builder per divisi.** Divisi admin menyusun form sendiri: judul, deskripsi, daftar
  pertanyaan, tipe field, wajib/opsional, urutan.
- **Jendela buka–tutup.** Form punya periode penerimaan. Di luar periode, endpoint publik
  menolak — bukan hanya menyembunyikan tombol.
- **Ownership divisi.** Setiap form punya `division_id`. Divisi hanya melihat dan mengedit
  form miliknya. BPH/platform admin bisa mode "lihat semua" bila diberi permission.
- **Endpoint publik per form.** Satu slug untuk pengisian, dapat dibagikan sebagai link dan
  QR. Slug milik divisi tidak boleh bisa ditebak ke form divisi lain.
- **Rekap per form.** Jumlah respons, distribusi jawaban per pertanyaan, dan daftar respons
  terbaru — cukup untuk divisi mengambil keputusan tanpa ekspor manual.
- **Lampiran opsional.** Upload file per pertanyaan bila dibutuhkan, dengan batasan jumlah,
  ukuran, dan ekstensi.
- **Status draft / published / closed.** Mengikuti pola Event: publish adalah aksi
  tersendiri dengan permission sendiri, bukan efek samping dari save.

Batas tegas terhadap sistem Advokasi:

| | Modul Form Hub | Campaign Studio Advokasi |
|---|---|---|
| Pemilik | Semua divisi **kecuali** Advokasi | Advokasi |
| Domain | `bph-cms.sga-cakrawala.org` | `satgas.sga-cakrawala.org` |
| Data | Tabel baru di D1 Hub | `Campaign`, `Submission`, dst. — **tidak dipindah** |
| Identitas pengguna | auth service superapp | auth service superapp **setelah D-A** |

Yang **tidak** dilakukan modul ini:

- Tidak memigrasikan campaign atau submission Advokasi.
- Tidak mengambil alih `POST /api/v1/reports` (kontrak 1:1 Laravel, dilarang diubah).
- Tidak mengubah URL `sga-cakrawala.org/student-voice/<slug>` maupun format legacy
  `?campaign=<slug>` yang QR-nya sudah tercetak dan tersebar.
- Tidak menggabungkan Laporan Advokasi (kasus) ke dalam Form. Laporan advokasi adalah
  jalur tindak lanjut kasus, bukan pengumpulan data umum.

Prasyarat keamanan yang wajib ikut sejak desain, bukan ditambal belakangan — mengambil
pelajaran dari hardening yang sudah terbukti di Advokasi:

- CORS exact allow-list, bukan `*` di production.
- Skema form **dibaca ulang dari database pada setiap POST** dan divalidasi ulang di
  server. Pilihan jawaban tidak boleh bisa dipalsukan dari client.
- Honeypot anti-bot dan rate limit per IP per form.
- Nama file acak; identitas pelapor di-hash bila fitur anonim dipakai.
- Pesan error internal tidak dikirim ke client.
- Deny by default: endpoint publik hanya menerima form berstatus `published` dan dalam
  periode buka. Form draft atau tertutup mengembalikan 404, bukan 403 — supaya keberadaan
  form yang belum rilis tidak bocor.

**Belum diputuskan dan butuh PRD tersendiri sebelum SDD** (pola yang sama seperti QPR):

- Daftar tipe field versi 1. Advokasi punya 10 tipe; modul Hub belum tentu butuh sebanyak
  itu di awal.
- Apakah identitas pengisi wajib, opsional, atau bisa anonim — dan siapa yang boleh
  melihat identitas itu.
- Apakah perlu approval sebelum form divisi tayang publik.
- Apakah rekap Hub perlu menarik ringkasan campaign Advokasi secara read-only supaya BPH
  punya satu tempat melihat partisipasi lintas divisi (§1.4).

#### F. Account & Access Management

Halaman baru untuk BPH/platform admin:

- daftar user,
- daftar divisi,
- tambah akun,
- suspend akun,
- ubah role,
- ubah akses modul,
- lihat siapa punya akses apa.

Fitur penting:

- search user,
- filter divisi,
- badge role,
- riwayat perubahan role.

#### G. Audit Log

Semua aksi penting disimpan:

- login,
- create/update/delete event,
- publish/unpublish,
- upload media,
- create/suspend account,
- change role,
- akses ditolak karena permission.

Audit log membantu debugging dan mencegah akses liar.

#### H. Approval Flow Event

Fitur opsional tapi bagus untuk fase berikut:

- Contributor membuat draft.
- Admin divisi review.
- Admin divisi publish.
- BPH bisa melihat queue lintas divisi jika dibutuhkan.

Ini menjaga kualitas konten tanpa menghambat input data.

#### I. Unified Calendar

Kalender admin menampilkan:

- event divisi sendiri,
- event semua divisi jika user punya akses,
- warna per divisi,
- filter divisi,
- filter status draft/published/ongoing/upcoming/past.

#### J. Future Module Marketplace

Dashboard bisa disiapkan seperti “rak modul”.

Contoh modul masa depan:

| Modul | Pengguna | Gambaran |
|---|---|---|
| QPR | BPH | Penilaian internal dan rekap. |
| Event | Semua divisi | Event, runsheet, pendaftaran, kalender. |
| Content Blocks | Ristek/BPH | Hero, about, visi-misi, konten landing page. |
| Program Kerja | Semua divisi | Rencana kerja, status, timeline. |
| Announcement | BPH/divisi tertentu | Pengumuman publik atau internal. |
| Document Hub | Internal SGA | Arsip surat, SOP, template, notulen. |
| ~~Form Builder~~ | — | **Sudah naik jadi modul nyata** — lihat §7.2-E, bukan lagi modul masa depan |
| Media Library | Semua divisi | Asset gambar dengan ownership dan reuse. |
| Analytics | BPH/Ristek | Statistik event, konten, dan aktivitas admin. |

### 7.3 Technology Direction

Tetap mengikuti stack sekarang:

- Cloudflare Workers,
- Hono,
- Drizzle,
- D1,
- R2,
- React panel,
- service auth superapp.

Perubahan backend yang disarankan:

- tambah tabel `divisions`,
- tambah tabel `cms_memberships`,
- tambah tabel `cms_roles` atau role enum awal,
- tambah tabel `cms_permissions` jika butuh custom permission,
- tambah tabel `audit_logs`,
- tambah kolom ownership di `events`,
- ubah middleware dari `requireRole("admin")` menjadi `requirePermission(permission, scope)`.

Contoh konsep scope:

| Scope | Arti |
|---|---|
| `own_division` | Hanya data divisi user. |
| `all_divisions` | Semua data lintas divisi. |
| `module_only` | Hanya modul tertentu, misalnya QPR. |

### 7.4 Security Rules

Aturan keamanan wajib:

- deny by default,
- least privilege,
- backend validasi permission di setiap request,
- UI hanya menyembunyikan fitur, bukan sumber keamanan,
- object-level authorization: user tidak boleh update event divisi lain dengan menebak ID,
- audit semua aksi penting,
- review akses berkala per periode kepengurusan.

### 7.5 Assumptions

Diperbarui 10 Sep 2026. Sebagian sudah terjawab oleh keputusan §1.2; sisanya masih terbuka.

| Asumsi | Status |
|---|---|
| Daftar final divisi SGA | ✅ **Terjawab.** 8 divisi sudah diseed ke D1 production: BPH, Ristek, UKM, Advokasi, BNP, ICD, Public Relation, Media (`drizzle/0001_watery_skreet.sql:62-71`) |
| Modul mana yang paling cepat setelah Event dan QPR | ✅ **Terjawab.** Modul Form/Campaign lintas divisi (§7.2-E), diputuskan 10 Sep 2026 |
| Apakah setiap divisi punya satu akun bersama atau akun personal per pengurus | 🔶 **Terjawab sebagian.** Identitas terpusat di auth service sudah diputuskan (D-A, §1.2). Bentuk akunnya — shared vs personal — **masih terbuka**; rekomendasi dokumen ini tetap akun personal demi audit yang benar |
| Siapa yang boleh membuat akun baru: BPH saja, Ristek saja, atau dua-duanya | ❌ **Masih terbuka.** Wewenang BPH sebagai product owner |
| Apakah BPH boleh mengedit event divisi lain atau hanya melihat | ❌ **Masih terbuka.** Wewenang BPH. Saat ini permission `events.*.all` ada di `platform_admin`, jadi secara teknis sudah bisa — kebijakannya yang belum ditetapkan |
| Apakah contributor boleh langsung publish atau harus approval | ❌ **Masih terbuka.** Saat ini contributor dibatasi draft-only; approval flow (§7.2-H) belum dibangun |

Tambahan baru yang muncul dari §1.4 dan §7.2-E, juga **masih terbuka**:

- Apakah rekap Hub perlu menarik ringkasan campaign Advokasi secara read-only.
- Apakah identitas pengisi form wajib / opsional / anonim.
- Daftar tipe field versi 1 modul Form.
- Nasib `dashboard_url` Ristek (`https://ristek.sga-cakrawala.org`) yang sudah ter-seed di
  production tapi **tidak resolve** (HTTP 000, dites 10 Sep 2026) — dibangun, atau
  di-nonaktifkan dulu lewat `workspace_options.is_active = 0` supaya tombolnya tidak
  muncul sebelum tujuannya ada.

---

## 8. Release

### Phase 1 — Access Foundation ✅ selesai

Tujuan: ubah CMS dari single-admin menjadi multi-divisi.

Isi:

- model divisi dan membership,
- middleware permission baru,
- endpoint `GET /me` untuk panel,
- feature gate menu panel,
- event punya owner division,
- migrasi event lama ke divisi BPH.

**Status:** live di production sejak 9 Sep 2026.

### Phase 2 — Event Multi-Divisi ⚠️ backend selesai, adopsi hampir penuh

Tujuan: semua divisi bisa mengelola event sendiri.

Isi:

- Event list scoped by division,
- create/edit/publish event per divisi,
- filter divisi di admin calendar,
- endpoint publik event tetap gabungan,
- optional query publik `division`.

**Status (diperbarui 11 Sep 2026):** backend & panel live, dan **6 divisi sudah bisa
memakainya**. Akun auth service + baris `cms_memberships` untuk UKM, Advokasi, BNP, ICD,
Public Relation, dan Media sudah dibuat 10 Sep 2026 dan diverifikasi login + terisolasi di
production (`PRODUCTION-READINESS-2026-09-10.md` §6.2–§6.3).

> Catatan: versi sebelumnya bagian ini menulis "tertahan karena 6 divisi belum punya akun
> di auth service". Itu benar saat ditulis (9 Sep) tetapi sudah tidak berlaku —
> provisioning-nya dikerjakan 10 Sep.

Yang **masih** menahan Phase 2 jadi penuh:

- **Ristek belum punya membership** → `permissions` kosong, 403 di semua endpoint admin
  termasuk panel. Ristek hanya bisa membuka `/docs/` (ada di `DOCS_ALLOW_EMAILS`).
- **BPH masih lewat jalur bootstrap** `PLATFORM_BOOTSTRAP_EMAILS`, bukan baris membership.
  Selama ini masih hidup, satu akun admin penuh bergantung pada var config.
- Keduanya butuh `user_id` dari auth service, yang hanya bisa didapat dengan login sebagai
  akun itu. Setelah barisnya ada, kosongkan var bootstrap untuk mematikan jalur itu.
- **Rotasi password 6 akun divisi** — teksnya ada di git history
  (`docs/DIVISION-ACCOUNTS.md`) dan repo ini public. Prioritas tertinggi menurut
  `PRODUCTION-READINESS-2026-09-10.md` §6.4.

### Phase 3 — One Identity (D-A) 🆕

Tujuan: seluruh aplikasi SGA mengakui satu penerbit sesi, sehingga "pilih dashboard"
benar-benar memindahkan user, bukan melemparnya ke halaman login lain.

Isi:

- AdvocationDashboard berhenti memakai Auth.js v5 Credentials + tabel `User` /
  `PasswordResetToken` lokal, dan beralih memvalidasi sesi dari service `auth`
  (`sga-superapp-auth`) lewat service binding — pola yang sudah dipakai `bph-cms`
  (`wrangler.jsonc:44-48`, binding `AUTH_SERVICE`).
- Pemetaan basis user admin Advokasi yang sudah ada ke identitas di auth service.
  **Tidak boleh ada admin yang terkunci keluar** di tengah peralihan.
- Sumber nilai `created_by` / `updated_by` / `deleted_by` pindah ke nama dari profil auth
  service. Nilai historis yang sudah tersimpan tidak ditulis ulang.
- Halaman `(auth)/*` Advokasi (login, register, forgot-password, reset-password) dihapus
  atau diarahkan ke Hub.
- ✅ **Selesai di sisi Hub (10 Sep 2026, commit `c485574`):** `panel/src/App.jsx:96-118`
  tidak lagi `window.location.href` telanjang — panel meminta one-time code lewat
  `POST /api/v1/admin/workspace-handoff` lalu pindah ke `redirect_to`. Yang dibawa di URL
  adalah kode sekali pakai TTL 60 detik, **bukan** token (`ACCOUNTS-ACCESS.md` §6
  melarang token di query string; koreksi SDD §4.5 menjelaskan kenapa kode boleh).
  Sisanya: route `/sso` di Advokasi + set `HANDOFF_SHARED_SECRET` di kedua Worker.
- ~~Cookie sesi di scope domain induk `.sga-cakrawala.org`~~ — ❌ **dicabut 10 Sep 2026.**
  Panel Hub menyimpan token di `localStorage` yang terisolasi per origin, dan backend Hub
  **menolak cookie secara sengaja** (`src/middlewares/admin-auth.ts:14-18`, alasan:
  permukaan CSRF). Cookie bersama bukan jalur yang tersedia tanpa merombak desain auth Hub.
  Mekanisme yang dipakai adalah one-time handoff code — lihat SDD §4.5 untuk versi benar.

**Batas keras:** modul data, endpoint publik, URL/QR, dan storage Advokasi **tidak
disentuh** (§1.3).

**Risiko utama:** ini membongkar aplikasi yang sedang live dan sedang dipakai. Butuh
strategi peralihan yang tidak mengunci admin Advokasi keluar.

### Phase 4 — Sambungkan Event ke Landing Page (KR4) 🟡 kode selesai, belum tayang

> **Status 10 Sep 2026:** dikerjakan di repo `sga-landing-page`. `src/lib/hub-events.ts`
> baru (Zod mirror `eventListItemSchema`, `AbortSignal`, cache 60 detik),
> `VITE_BPH_API_URL` ditambahkan, `sections/event/index.tsx` turun 555 → 371 baris dan
> sekarang fetch. Fallback saat API gagal = notice di dalam section, halaman tidak blank.
> **Tapi belum di-commit & belum di-deploy** — bundle live `sga-cakrawala.org` belum
> memuat `bph-cms.sga-cakrawala.org`, dan tampilan belum dicek di browser.
> Sisa: review → commit → deploy → cek visual.

Tujuan: event yang dibuat divisi di Hub benar-benar tampil di situs publik.

Isi:

- `sga-landing-page/src/components/sections/event/index.tsx` (dulunya 555 baris JSX
  hardcoded) diganti menjadi konsumen `GET /api/v1/events` dan `GET /api/v1/events/calendar`.
- Tambah env `VITE_BPH_API_URL` yang sudah dijanjikan `CONTEXT.md` §3 tapi tidak pernah
  dibuat.
- Pola fetch/cache/error mengikuti `src/components/reporting/form.tsx` (rekan repo yang
  sudah terbukti).
- Status `ongoing/upcoming/past` **dihitung server** — FE tidak boleh menghitung ulang
  atau menimpanya (`CONTEXT.md` §6).
- Fase 1 Google Calendar tetap tanpa backend: template URL di FE (`CONTEXT.md` §7).

**Catatan:** fase ini ada di repo `sga-landing-page`, bukan di repo ini. Dicatat di PRD
Hub karena KR4 adalah key result Hub dan tidak bisa dicapai dari backend saja.

### Phase 5 — Account & Access Management

Tujuan: BPH/platform admin bisa mengatur akun tanpa edit database.

Isi:

- halaman Akun & Akses,
- invite user,
- assign divisi,
- assign role,
- suspend account,
- audit role changes.

**Ketergantungan:** butuh Phase 2 selesai secara adopsi (akun divisi sudah ada) supaya
halaman ini punya isi untuk dikelola.

### Phase 6 — Modul Form Lintas Divisi (D-B) 🆕

Tujuan: setiap divisi selain Advokasi bisa membuat, membuka, dan merekap form sendiri.

Isi: spesifikasi lengkap di §7.2-E.

**Prasyarat:** butuh **PRD Form tersendiri sebelum SDD**, mengikuti pola QPR
(`QPR-PRD.md` masih draft dan menunggu konfirmasi BPH sebelum SDD ditulis). Yang harus
dijawab dulu: daftar tipe field v1, kebijakan identitas pengisi, dan apakah perlu
approval sebelum tayang.

**Urutan Phase 4 vs Phase 6 belum diputuskan** (dicatat sebagai D-D di register keputusan
Ristek). Menumpuk modul baru di atas KR4 yang belum tertutup
adalah risiko yang diakui, bukan yang diabaikan.

### Phase 7 — QPR BPH-Only

Tujuan: mulai bangun QPR dengan akses terbatas.

Isi:

- QPR hanya muncul untuk BPH,
- schema QPR,
- periode penilaian,
- assignment penilai,
- form penilaian,
- rekap awal.

**Status:** `QPR-PRD.md` masih draft v0.1 dan **terblokir sebelum SDD** — menunggu
konfirmasi BPH atas kepanjangan QPR, periode penilaian, pasangan penilai–dinilai,
anonimitas hasil, dan bobot penilaian.

### Phase 8 — Workflow & Future Modules

Tujuan: dashboard terpadu mulai menjadi platform internal SGA.

Isi:

- approval flow event,
- document hub,
- announcement,
- program kerja,
- analytics,
- media library lintas modul.

### Ringkasan urutan

```
Phase 1 ✅ ─► Phase 2 ⚠️ (butuh akun divisi)
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
  Phase 3 🆕 One Identity   Phase 4 🆕 Landing page
  (D-A, bongkar auth Advo)  (KR4, repo sga-landing-page)
        │                       │
        └───────────┬───────────┘
                    ▼
              Phase 5 Account & Access
                    ▼
         Phase 6 🆕 Modul Form (D-B) ── butuh PRD Form dulu
         Phase 7 QPR ── terblokir, nunggu BPH
                    ▼
              Phase 8 Future Modules
```

**Urutan Phase 3 / Phase 4 / Phase 6 relatif satu sama lain masih terbuka (D-D).**
Yang pasti hanya ketergantungannya: Phase 5 butuh Phase 2 beres secara adopsi, dan
Phase 6 butuh PRD Form disetujui lebih dulu.

---

## Appendix A — Draft Role Matrix

| Fitur | BPH Admin | Divisi Admin | Contributor | Viewer |
|---|---:|---:|---:|---:|
| Dashboard ringkasan | Ya | Ya | Ya | Ya |
| Event lihat | Semua / sesuai izin | Divisi sendiri | Divisi sendiri | Divisi sendiri |
| Event buat | Ya | Ya | Draft | Tidak |
| Event edit | Semua / sesuai izin | Divisi sendiri | Draft sendiri | Tidak |
| Event publish | Ya / sesuai izin | Divisi sendiri | Tidak | Tidak |
| QPR | Ya | Tidak | Tidak | Tidak |
| Akun & Akses | Ya | Tidak | Tidak | Tidak |
| Audit Log | Ya | Terbatas | Tidak | Tidak |
| Media Library | Ya | Divisi sendiri | Upload draft | Lihat |

---

## Appendix B — Inspirasi Luar

Hal yang diambil dari praktik produk di luar:

- Role dan permission harus granular, bukan satu label `admin`.
- Akses aplikasi dan izin dalam aplikasi bisa dipisah. Seseorang bisa boleh mengatur akses modul, tetapi belum tentu boleh mengedit isi modul.
- Permission harus dicek di server pada setiap request.
- Sistem besar memakai audit log dan review akses supaya izin tidak melebar diam-diam.
- Untuk kebutuhan yang punya scope data, role saja tidak cukup. Perlu atribut seperti divisi pemilik data dan hubungan user terhadap data.

Referensi:

- OWASP Authorization Cheat Sheet.
- NIST RBAC FAQ.
- Atlassian admin roles dan app access.
- Microsoft Entra privileged role best practices.
