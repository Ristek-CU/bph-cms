# PRD — SGA CMS Hub: Dashboard Terpadu Multi-Divisi

**Versi:** 0.1
**Tanggal:** 7 September 2026
**Status:** Draft eksplorasi untuk diskusi
**Audience:** BPH, Ristek, seluruh divisi SGA, Backend, Frontend, UI/UX
**Dokumen terkait:** [CONTEXT.md](./CONTEXT.md), [SDD-SGA-CMS-HUB.md](./SDD-SGA-CMS-HUB.md), [RUNNING-GUIDE.md](./RUNNING-GUIDE.md), [DIVISION-ACCOUNTS.md](./DIVISION-ACCOUNTS.md), [ACCOUNTS-ACCESS.md](./ACCOUNTS-ACCESS.md), [PRD.md](./PRD.md), [PANEL-UI.md](./PANEL-UI.md), [QPR-PRD.md](./QPR-PRD.md), [API.md](./API.md)

---

## 1. Summary

SGA CMS Hub adalah dashboard terpadu untuk semua divisi SGA. Setiap divisi punya akun sendiri, tetapi hanya melihat fitur dan data yang memang boleh mereka akses.

Modul Event menjadi fitur bersama untuk semua divisi. Modul QPR tetap khusus BPH. Ke depan, dashboard ini bisa menampung modul lain seperti publikasi konten, dokumen, program kerja, approval, dan laporan.

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

| KR | Target |
|---|---|
| KR1 | 100% endpoint admin punya pengecekan izin berbasis role + scope divisi. |
| KR2 | Divisi non-BPH tidak bisa melihat menu QPR dan API QPR mengembalikan 403. |
| KR3 | Semua divisi bisa membuat, mengedit, publish, dan unpublish event milik divisinya sendiri. |
| KR4 | Landing page bisa menampilkan event dari semua divisi yang sudah published. |
| KR5 | Semua perubahan penting tercatat di audit log: siapa, divisi apa, aksi apa, kapan. |

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

#### E. Account & Access Management

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

#### F. Audit Log

Semua aksi penting disimpan:

- login,
- create/update/delete event,
- publish/unpublish,
- upload media,
- create/suspend account,
- change role,
- akses ditolak karena permission.

Audit log membantu debugging dan mencegah akses liar.

#### G. Approval Flow Event

Fitur opsional tapi bagus untuk fase berikut:

- Contributor membuat draft.
- Admin divisi review.
- Admin divisi publish.
- BPH bisa melihat queue lintas divisi jika dibutuhkan.

Ini menjaga kualitas konten tanpa menghambat input data.

#### H. Unified Calendar

Kalender admin menampilkan:

- event divisi sendiri,
- event semua divisi jika user punya akses,
- warna per divisi,
- filter divisi,
- filter status draft/published/ongoing/upcoming/past.

#### I. Future Module Marketplace

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
| Form Builder | Divisi tertentu | Form sederhana untuk kebutuhan internal. |
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

Hal yang perlu dikonfirmasi:

- Daftar final divisi SGA.
- Siapa yang boleh membuat akun baru: BPH saja, Ristek saja, atau dua-duanya.
- Apakah BPH boleh mengedit event divisi lain atau hanya melihat.
- Apakah setiap divisi punya satu akun bersama atau akun personal per pengurus. Rekomendasi: akun personal.
- Apakah contributor boleh langsung publish atau harus approval.
- Modul mana yang paling cepat setelah Event dan QPR.

---

## 8. Release

### Phase 1 — Access Foundation

Tujuan: ubah CMS dari single-admin menjadi multi-divisi.

Isi:

- model divisi dan membership,
- middleware permission baru,
- endpoint `GET /me` untuk panel,
- feature gate menu panel,
- event punya owner division,
- migrasi event lama ke divisi BPH.

### Phase 2 — Event Multi-Divisi

Tujuan: semua divisi bisa mengelola event sendiri.

Isi:

- Event list scoped by division,
- create/edit/publish event per divisi,
- filter divisi di admin calendar,
- endpoint publik event tetap gabungan,
- optional query publik `division`.

### Phase 3 — Account & Access Management

Tujuan: BPH/platform admin bisa mengatur akun tanpa edit database.

Isi:

- halaman Akun & Akses,
- invite user,
- assign divisi,
- assign role,
- suspend account,
- audit role changes.

### Phase 4 — QPR BPH-Only

Tujuan: mulai bangun QPR dengan akses terbatas.

Isi:

- QPR hanya muncul untuk BPH,
- schema QPR,
- periode penilaian,
- assignment penilai,
- form penilaian,
- rekap awal.

### Phase 5 — Workflow & Future Modules

Tujuan: dashboard terpadu mulai menjadi platform internal SGA.

Isi:

- approval flow event,
- document hub,
- announcement,
- program kerja,
- analytics,
- media library lintas modul.

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
