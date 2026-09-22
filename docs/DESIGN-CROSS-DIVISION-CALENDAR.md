# Design: Kalender Lintas Divisi (Internal BPH)

## 1. Tujuan
Fitur untuk BPH melihat jadwal/event lintas divisi dalam satu kalender/agenda, agar koordinasi dan pengumuman internal lebih mudah. Kalender ini **hanya diakses di dalam CMS Hub**, tidak dipublikasikan ke publik.

## 2. Non-Goals
- Bukan landing page publik.
- Bukan feed/event public API yang terbuka.
- Tidak menggantikan detail event per divisi.

## 3. User Story
Sebagai BPH, saya ingin membuka halaman kalender lintas divisi, melihat event semua divisi per bulan/minggu, lalu menyalin atau membagikan ringkasan jadwal sebagai pesan WhatsApp kepada pengurus.

## 4. Data & Permission
- **Sumber data:** endpoint yang sama dengan `/admin/events` (sudah ada), tetapi tanpa filter `divisionId` untuk user BPH/akun dengan permission cukup.
- **Permission:**
  - Minimal `events.read` (atau `events.read.all`).
  - BPH biasanya punya akses ke semua divisi melalui `events.read.all`.
- **Scope data:** semua event dengan status `published` dan `draft` dari semua divisi.

## 5. UI/UX
### 5.1 Lokasi
- Route baru: `/calendar` atau `/events/cross-division-calendar`.
- Sidebar CMS Hub menambahkan menu "Kalender Lintas Divisi" untuk user yang punya akses.

### 5.2 Tampilan
- **Tampilan Kalender (bulan):** lihat dot/chip event per hari, warna per divisi.
- **Tampikan Agenda (list):** daftar event terdekat dengan tanggal, divisi, lokasi, status.
- **Filter:** per divisi, per status (draft/published), per rentang tanggal.
- **Pencarian:** cari event berdasarkan judul.

### 5.3 Aksi BPH
- **Tombol "Salin pesan WhatsApp":** generate teks ringkasan jadwal dan copy ke clipboard.
- **Tombol "Share ke WhatsApp":** membuka link `https://wa.me/?text=...` (jika browser/mobile mendukung) atau fallback ke copy.
- **Tombol "Export" (opsional):** download daftar event sebagai `.txt` atau `.ics` (future enhancement).

## 6. Format Pesan WhatsApp
Contoh template pesan yang dihasilkan:

```
📅 Jadwal Lintas Divisi SGA Cakrawala

🗓️ Senin, 23 September 2026
• [09:00] Workshop Keuangan — Divisi Keuangan 📍 Aula Utama
• [13:00] Rapat Koordinasi — BPH 📍 Ruang Rapat 2

🗓️ Kamis, 25 September 2026
• [08:00] Open Recruitment — Divisi PSDM 📍 Lapangan Kampus

_Lihat detail di CMS Hub > Kalender Lintas Divisi._
```

## 7. API (Backend)
- **GET `/admin/events?all_divisions=true`** (re-use endpoint existing, tambahkan query param `all_divisions` untuk BPH).
- Response tetap sama seperti `/admin/events` list, tetapi tanpa filter `divisionId`.

### Permission Check
- Jika user punya `events.read.all`, izinkan `all_divisions=true`.
- Jika tidak, tolak atau fallback ke divisi sendiri.

## 8. Frontend
- Buat halaman baru `panel/src/pages/CrossDivisionCalendar.jsx`.
- Gunakan komponen `Calendar.jsx` yang sudah ada sebagai dasar, dengan mode "read-only lintas divisi".
- Tambahkan helper `formatWhatsAppMessage(events)` di `panel/src/utils/calendar-share.js`.

## 9. Security & Privacy
- Halaman hanya bisa diakses setelah login dan punya permission.
- Tidak ada endpoint publik baru.
- Data draft tetap terlihat di kalender internal (untuk koordinasi BPH), tidak di-publish keluar.

## 10. Implementation Plan
1. **Backend:** update `event.service.ts` → `listAdmin` support `allDivisions: true`.
2. **Backend:** update route handler `admin.events.ts` untuk menerima `all_divisions` query dan cek permission.
3. **Frontend:** buat `CrossDivisionCalendar.jsx` dan route `/calendar` di `App.jsx`.
4. **Frontend:** tambahkan menu di sidebar `Shell.jsx` untuk user BPH.
5. **Frontend:** implement tombol "Salin pesan WA" dan "Share ke WA".
6. **Test:** unit test helper format WA, integrasi list event lintas divisi.
7. **Deploy:** build, test, commit, push, deploy.

## 11. Open Questions
- Apakah event `draft` boleh muncul di kalender lintas divisi, atau hanya `published`?
- Apakah format WA ingin pakai emoji tertentu atau gaya lain?
- Apakah perlu fitur "pilih rentang tanggal" untuk export WA, atau cukup bulan aktif?
