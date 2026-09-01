# PANEL-UI — Spesifikasi Dashboard Admin CMS BPH

**Versi:** 1.0
**Tanggal:** 2 September 2026
**Status:** Draft untuk review
**Audiens:** FE panel (React SPA di `panel/`), UI/UX, pimpinan BPH
**Acuan pola:** AdvocationDashboard (`~/ristek/AdvocationDashboard`) — sidebar + card + form berseksi, bahasa Indonesia
**Dokumen terkait:** [PRD.md](./PRD.md) · [SDD.md](./SDD.md) · [QPR-PRD.md](./QPR-PRD.md) · [FE-INTEGRATION.md](./FE-INTEGRATION.md)

---

## 1. Prinsip Desain

Pengguna panel = **pengurus BPH, non-teknis**. Semua keputusan UI tunduk pada 5 prinsip ini:

1. **Bahasa Indonesia penuh.** Istilah teknis (slug, draft, publish) diberi penjelasan singkat, bukan diganti istilah asing lain. Contoh: label "Slug (alamat link)" dengan teks bantuan "Kosongkan untuk dibuat otomatis dari judul."
2. **Satu halaman, satu tugas.** Tidak ada layar yang memaksa mengisi dua konsep sekaligus. Editor event dipecah menjadi seksi bernomor.
3. **Status selalu terlihat.** Setiap event membawa badge status (Draft / Terbit / Berlangsung / Selesai) yang dihitung dari waktu — admin tidak pernah mengetik status manual.
4. **Aksi destruktif selalu dikonfirmasi** dengan kalimat jelas ("Hapus permanen beserta semua sesi. Tidak bisa dibatalkan.").
5. **Kosong bukan kegagalan.** State "belum ada event" menampilkan ajakan buat event pertama + tombol besar, bukan tabel hampa.

Warna mengikuti identitas SGA (dipakai AdvocationDashboard): primary teal `#009180` / navy `#06455B`, aksen emas `#CEAE65`/`#EBC05F`, latar terang.

---

## 2. Kerangka Layout

```
┌──────────┬─────────────────────────────────────────────┐
│ SIDEBAR  │  Header halaman (judul + breadcrumb)        │
│          ├─────────────────────────────────────────────┤
│ Logo SGA │                                             │
│          │   Konten halaman aktif                      │
│ ▣ Ringkasan                                            │
│ ▣ Event  │                                             │
│ ▣ QPR    │                                             │
│   (segera)                                            │
│          │                                             │
│ ─────────│                                             │
│ [User]   │                                             │
└──────────┴─────────────────────────────────────────────┘
```

- **Sidebar kiri** (tetap tampil desktop, jadi drawer di layar sempit):
  - `Ringkasan` — dashboard singkat (§3)
  - `Event` — modul Student Event (§4)
  - `QPR` — modul penilaian internal (§5, tampil dengan badge "Segera", nonaktif)
- **Footer sidebar**: kartu user (nama, email, menu Keluar).
- Header halaman: judul seksi + aksi utama kanan (mis. "+ Event baru").
- Rute SPA: `/` (ringkasan), `/events` (list), `/events/baru`, `/events/:id/edit`, `/events/kalender`. Hash routing cukup — panel di-host sebagai aset Worker, tidak perlu rewrite tambahan.

### 2.1 Struktur file panel (usulan)

```
panel/src/
  App.jsx            — router + layout shell
  api.js             — fetch helper + konversi WIB (sudah ada)
  components/        — Sidebar, Badge, Modal konfirmasi, dsb.
  pages/
    Overview.jsx
    EventList.jsx
    EventCalendar.jsx
    EventEditor.jsx  — form berseksi (dipakai baru & edit)
```

Tanpa library UI tambahan — CSS murni di `index.css`, komponen kecil sendiri. (Ponytail: pindah ke shadcn/ui kalau panel > 10 halaman.)

---

## 3. Halaman Ringkasan (`/`)

Tujuan: admin buka panel, 3 detik tahu kondisi.

- Kartu sapaan + 4 angka ringkas dari `GET /api/v1/admin/events`: total event, **berlangsung sekarang**, akan datang terdekat, masih draft.
- Bawahnya: daftar 5 event terdekat (nama, tanggal WIB, badge status, tombol Edit).
- Event berlangsung diberi highlight emas + tautan "Salin link publik".

---

## 4. Modul Event

### 4.1 List Event (`/events`)

Grid kartu (2 kolom desktop, 1 kolom HP) — mengikuti pola Campaign Studio:

```
┌───────────────────────────────────────────┐
│ ████ garis gradasi teal→emas (aksen)      │
│ Judul Event                 [Terbit]      │
│ /judul-event                             │
│ 10 Sep 2026, 08:00 – 17:00 WIB            │
│ 📍 Cakrawala University · 4 sesi          │
│ [Salin link] [Edit] [⋮ → Publikasi/Hapus]│
└───────────────────────────────────────────┘
```

- Badge status: `Draft` (abu) · `Terbit — Berlangsung` (hijau) · `Terbit — Akan Datang` (biru) · `Terbit — Selesai` (abu gelap). Status berjalan dihitung klien dari `starts_at/ends_at`; kolom `status` API hanya draft/published.
- Baris pencarian (filter judul/slug/lokasi, lokal — data diambil semua via `GET /admin/events`) + chip filter `Semua / Draft / Berlangsung / Akan datang / Selesai`.
- Kartu kosong state: "Belum ada event. Buat event pertama →".
- Tombol utama header: **+ Event baru**.
- "Salin link" menyalin `https://sga-cakrawala.org/events/<slug>` (tautan publik milik LP; hanya aktif setelah publish — beri toast "Link aktif setelah event diterbitkan" bila masih draft).

### 4.2 Kalender Event (`/events/kalender`)

Kalender bulanan ala Google Calendar, murni klien dari data `GET /admin/events` (sudah berisi semua event + sesi):

- Grid 7 kolom, header hari Senin–Minggu, bulan berjalan + navigasi ‹ ›.
- Setiap tanggal menampilkan chip event (judul dipotong, warna per status). Event multi-hari membentang dengan tanda lanjut "›".
- Klik chip → panel samping detail ringkas → tombol Edit.
- Klik tanggal kosong → **buka editor event baru dengan tanggal itu terisi** (prefill `starts_at` 08:00, `ends_at` 17:00 WIB).
- Sub-header kalender: legenda warna + tombol "+ Event baru".
- Format tanggal/waktu selalu WIB (`Asia/Jakarta`), label "WIB" eksplisit di sudut grid.

### 4.3 Editor Event (`/events/baru` dan `/events/:id/edit`)

Form satu halaman dibagi **5 seksi bernomor** — urutan = urutan cara berpikir penyelenggara. Setiap seksi punya judul + 1 kalimat penjelas. Validasi klien ringan (wajib, format) SEBELUM kirim; pesan error server (422) dipetakan ke field terkait, ditampilkan merah di bawah input.

**Seksi 1 — Informasi Utama**
| Field | Label di UI | Tipe | Bantuan |
|---|---|---|---|
| `title` | Nama event * | teks | "Nama yang muncul di portal dan link share." |
| `slug` | Alamat link | teks (hanya saat buat baru) | "Kosongkan = dibuat otomatis dari nama. Contoh: `cakrawala-festival-2026`." |
| `description` | Deskripsi | textarea | "Ceritakan event-nya. Tampil di halaman detail." |
| `cover_image_url` | Foto cover | upload gambar + preview | "JPG/PNG/WebP, maks 5MB. Rasio disarankan 16:9. Ini foto utama yang dilihat mahasiswa." |
| `organizer` | Penyelenggara | teks | "Contoh: BPH SGA, BEM." |

**Seksi 2 — Waktu & Lokasi**
| Field | Label di UI | Tipe | Bantuan |
|---|---|---|---|
| `starts_at` | Mulai * | datetime | selalu WIB |
| `ends_at` | Selesai * | datetime | harus setelah mulai |
| `location` | Lokasi * | teks | "Contoh: Auditorium Lt. 2, Kampus Kemang." |
| `location_url` | Link Google Maps | URL | "Tempel link Maps agar tombol 'Lihat Lokasi' muncul." |

**Seksi 3 — Pendaftaran**
| Field | Label di UI | Tipe | Bantuan |
|---|---|---|---|
| `registration_url` | Link pendaftaran | URL | "Link Google Form / WhatsApp tempat mahasiswa mendaftar." |
| `registration_open` | Pendaftaran dibuka | toggle | "Kalau mati, tombol Daftar tidak muncul di halaman publik." |

**Seksi 4 — Runsheet (Timeline Sesi)**

Daftar sesi berulang. Setiap sesi = kartu:

```
┌─ Sesi 1 ──────────────────────────────┐
│ Nama sesi *  [Seminar Teknis: AI]      │
│ Jam: [13:00] – [15:00]  Tanggal: sama │
│ Pemateri [Nama]   Ruang [Auditorium]  │
│ Catatan [textarea 2 baris]            │
│                      [Hapus sesi]     │
└───────────────────────────────────────┘
[+ Tambah sesi]
```

- Default sesi baru: jam berikutnya setelah sesi terakhir (biar runsheet nyambung), tanggal sama dengan event.
- Sesi otomatis diurutkan per jam saat disimpan. Saat menampilkan, jam saja bila tanggal sama dengan event; tanggal+jam bila beda hari.
- Validasi ramah: sesi di luar jam event → pesan "Sesi 2 melebihi jam event. Perbaiki jam sesi atau perpanjang jam event." (server menolak `sessions.N` — panel terjemahkan ke bahasa ini.)
- Tip di bawah judul seksi: "Runsheet = jadwal rinci per jam yang dilihat mahasiswa di halaman event. Boleh dikosongkan dulu, bisa diisi nanti."

**Seksi 5 — Simpan & Terbitkan**

- Bar aksi melekat bawah: `[Simpan Draft]` `[Simpan & Terbitkan]` (edit: `[Simpan Perubahan]`) `[Hapus Permanen]` (hanya saat edit, merah, konfirmasi modal dua langkah).
- Setelah simpan baru: panel tetap di editor, muncul kotak "Event tersimpan sebagai draft" + **tombol Terbitkan** + pratinjau link publik.
- Pratinjau: karena endpoint publik 404 untuk draft, pratinjau menampilkan **render lokal di dalam panel** (komponen pratinjau sederhana: cover, judul, jadwal, lokasi, tombol daftar, runsheet timeline). Cukup meyakinkan untuk cek, tanpa API baru.

### 4.4 Alur Publish

1. Simpan → status `draft` (tidak terlihat publik).
2. Klik **Terbitkan** → konfirmasi ringan ("Event langsung tampil di portal SGA.") → `POST /admin/events/:id/publish`.
3. Badge berubah `Terbit — Akan Datang`. Muncul tombol **Salin link publik** dan **Tarik (unpublish)**.
4. Edit kapan saja; portal ikut berubah tanpa deploy.

### 4.5 Tambah ke Google Calendar (admin side info)

Di kartu detail ringkas (kalender & list) tersedia ikon 📅 "Tambah ke Google Calendar" — memakai template URL resmi (lihat [FE-INTEGRATION.md §5](./FE-INTEGRATION.md)), dibuka di tab baru. Membantu pengurus menaruh event ke kalender pribadi/organisasi.

---

## 5. Modul QPR (placeholder)

Sidebar menampilkan `QPR` dengan badge "Segera", klik → halaman penjelasan singkat + tombol nonaktif. Spesifikasi lengkap: [QPR-PRD.md](./QPR-PRD.md). Backend belum menyediakan endpoint — jangan buat UI palsu lebih dari ini.

---

## 6. State & Error

- Semua request lewat helper `api()` (`panel/src/api.js`) — token Bearer + unwrap `data`.
- 401 → bersihkan token, kembali ke login, toast "Sesi berakhir. Masuk lagi."
- Error 422 → render `errors` per field di seksi terkait (bahasa Inggris server diterjemahkan klien via kamus kecil; fallback tampilkan apa adanya).
- Kegagalan jaringan → banner "Tidak bisa menghubungi server. Cek koneksi, coba lagi."
- Toast/flash message untuk aksi sukses (tersimpan, diterbitkan, link disalin). Tanpa `alert()` browser — pakai komponen toast kecil.

## 7. Aksesibilitas & Mobile

- Label eksplisit untuk semua input; fokus keyboard terlihat; konfirmasi destruktif via modal (bukan `confirm()`).
- Layout 1 kolom di HP; sidebar jadi drawer; kalender tetap berfungsi dengan scroll horizontal bila perlu.
- Target sentuh minimal 44px.

## 8. Checklist Implementasi Panel

- [ ] Layout shell: sidebar + header + router hash
- [ ] Halaman Ringkasan
- [ ] List event: kartu + pencarian + chip filter + salin link
- [ ] Kalender bulanan + klik-tanggal-buat-event
- [ ] Editor 5 seksi + pratinjau lokal + publikasi
- [ ] Toast + modal konfirmasi + mapping error 422
- [ ] Mobile drawer + uji HP
