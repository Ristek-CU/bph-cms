# PRD — CMS BPH: Modul Student Event

**Versi:** 1.0
**Tanggal:** 1 September 2026
**Status:** Draft untuk review
**Audience:** Backend (fokus), Frontend, UI/UX, Pimpinan Divisi
**Dokumen terkait:** [Requirement v1.2 (PDF)](./SGA-CMS-Student-Event-Requirement.pdf)

---

## 1. Ringkasan Eksekutif

**CMS BPH** adalah service backend milik divisi BPH SGA Cakrawala yang menangani dua domain:
**form QPR** dan **event mahasiswa**. Modul pertama yang dibangun: **Student Event** —
portal event mahasiswa yang datanya dikonsumsi oleh Landing Page SGA.

Produk akhir dari sisi mahasiswa:

1. **Portal event** di `https://sga-cakrawala.org/events` — daftar event berlangsung & akan datang, kalender bulanan.
2. **Halaman detail per event** (`/events/:slug`) — target dari **share link** WA/IG: mahasiswa melihat jadwal lengkap per jam (runsheet) dan bisa mendaftar.
3. **Tambah ke Google Calendar** — satu klik dari halaman detail (template URL, tanpa backend).
4. **(Fase 2)** Sync otomatis ke kalender publik Google SGA — mahasiswa subscribe sekali, semua event masuk.

Admin (pengurus BPH) mengelola semua event melalui **admin panel** milik CMS BPH.

### Problem statement

Section Event di landing page saat ini hardcoded di dalam kode (6 kartu placeholder, status
"On Going" diketik manual). Setiap perubahan = edit kode + deploy ulang. Status sering salah.
Mahasiswa tidak punya tempat terpusat untuk melihat jadwal event, dan publikasi event tidak
bisa lewat link.

### Goal

- Admin BPH dapat mengelola event (buat, edit, jadwalkan runsheet, publish) **tanpa sentuh kode**.
- Mahasiswa melihat event yang sedang berjalan & akan datang secara **akurat otomatis**.
- Event dapat disebar via link; detail lengkap (per jam) terbaca dari HP.
- Landing page menampilkan event dinamis tanpa deploy ulang.

### Non-goal (v1)

- Pendaftaran/tiket event dalam sistem (registration hanya link eksternal).
- Notifikasi push/email dari sistem kita (notif reminder diberikan oleh Google Calendar setelah event masuk kalender user).
- Modul UKM / konten LP (mengikuti CMS masing-masing divisi — CMS Ristek).
- Mobile app.

---

## 2. Konteks Ekosistem

Landing page SGA adalah **SPA statis** (React + Vite, Cloudflare Pages) tanpa backend.
Semua konten dinamis datang dari service terpisah:

| CMS | Divisi | Tanggung jawab | Status |
|---|---|---|---|
| CMS Advo | Advocation | Student Voice (form pengaduan) | Live — `satgas.sga-cakrawala.org` |
| **CMS BPH** | BPH | **Event (dokumen ini)** + form QPR nanti | **Dibangun sekarang** |
| CMS Ristek | Ristek | Konten LP SGA (hero/about/vision), data UKM | Rencana |

Aturan ekosistem yang mengikat semua CMS (agar FE tidak menderita):

1. **Response wrapper seragam**: `{ success, message, data }` / error `{ success, message, errors }`.
2. **ISO 8601 dengan offset** untuk semua timestamp; tampilan WIB (Asia/Jakarta).
3. Error 422 berbentuk `{ success: false, message, errors: { field: [msg] } }`.
4. Frontend hanya konsumen `GET` publik; seluruh tulis-baca lewat admin panel masing-masing CMS.

Referensi pola: `packages/shared` di repo `sga-superapp` (`ApiResponse`, `ApiError`, pagination)
sudah mengimplementasikan konvensi ini — CMS BPH **wajib memakai pola yang sama**.

---

## 3. User Flow

### 3.1 Admin (BPH)

1. Login admin panel CMS BPH.
2. Modul Event → daftar event (judul, tanggal, status publish, jumlah sesi) — filter + search.
3. Buat event: judul, slug (auto-generate, editable), deskripsi, cover, mulai–selesai, lokasi (+link), registration URL (opsional), penyelenggara.
4. Tambah sesi runsheet: nama, jam mulai–selesai, pemateri, ruang — berapa pun, bisa diurutkan.
5. Simpan **Draft** (belum terlihat publik) → preview share link.
6. **Publish** → langsung terlihat di portal; (fase 2) ter-push ke Google Calendar.
7. Edit kapan saja — portal ter-update tanpa deploy ulang.

### 3.2 Mahasiswa

1. **Share link** (WA/IG) → detail event: cover, deskripsi, lokasi, runsheet per jam.
2. Atau dari LP → section Event (teaser) → "Lihat Lainnya" → portal `/events`.
3. Portal: card besar "Sedang Berlangsung" (menampilkan sesi yang sedang jalan + jam), section "Akan Datang", kalender bulanan.
4. Klik tanggal di kalender → daftar event tanggal itu. Klik event → detail.
5. Detail: Daftar (jika ada link), Tambah ke Google Calendar, Bagikan (share lagi — loop viral).
6. (Fase 2) Subscribe kalender publik SGA → semua event otomatis masuk Google Calendar pribadi.

---

## 4. Scope per Divisi

| Divisi | Scope | Bergantung pada |
|---|---|---|
| **BE (fokus utama)** | Service CMS BPH: auth admin, CRUD event+sessions, publish, endpoint publik, upload media, validasi, migrasi DB | — |
| FE | Portal `/events`, detail `/events/:slug`, kalender custom, dinamisasi section LP | Contract API (dummy JSON cukup) |
| UI/UX | Desain portal, detail (runsheet timeline), state non-ideal | — |
| BE fase 2 | Push-sync ke Google Calendar (service account) | Modul event stabil |

**FE tidak menunggu BE** — contract §5 (SDD) bersifat final; FE memakai dummy JSON sesuai contract, integrasi tinggal ganti base URL env.

---

## 5. Success Criteria

### Definisi selesai (backend — fokus utama)

- [ ] Admin dapat login, membuat event + sessions, upload cover, publish/unpublish.
- [ ] Endpoint publik mengembalikan data sesuai contract, **status dihitung server** (ongoing/upcoming/past), hanya `published`.
- [ ] Validasi server-side lengkap (termasuk sesi di dalam rentang event, `ends_at > starts_at`).
- [ ] Error konsisten `{ success, message, errors }`, HTTP status tepat.
- [ ] Struktur kode siap menampung modul berikutnya (QPR) tanpa refactor.
- [ ] Ada OpenAPI spec (repo superapp sudah memakai `hono-openapi` + Scalar).

### Definisi selesai (frontend, fokus berikutnya)

- [ ] `/events` + `/events/:slug` hidup dari API; kalender custom; share link punya preview WA (og meta).
- [ ] Section Event LP dinamis dari API; "Lihat Lainnya" → `/events`.

### Metrik (indikatif)

- Waktu publikasi event dari "admin klik publish" → "terlihat di LP": < 1 menit (cache TTL).
- Nol deploy ulang FE untuk perubahan konten event.

---

## 6. Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Admin salah input jam/timezone | Validasi server + ISO 8601 offset wajib; tampilan selalu WIB |
| Status manual dikhawatirkan salah | Sudah dirancang: status dihitung server, tidak ada kolom status manual |
| Contract berubah saat BE jalan | §5 bersifat final; perubahan wajib disepakati di grup sebelum implementasi FE berubah |
| Lonjakan trafik saat event | Read-only publik di edge (Workers) + rate limit + cache; trafik baca murah |

---

## 7. Timeline Bertahap

| Fase | Isi |
|---|---|
| 1 (sekarang) | BE: service + endpoint publik + admin panel dasar; FE: portal + detail + kalender (dummy → integrasi); tombol GCal template URL |
| 2 | Push-sync Google Calendar (service account), modul form QPR |
| 3 | Modul-modul berikutnya sesuai kebutuhan (dibahas terpisah) |
