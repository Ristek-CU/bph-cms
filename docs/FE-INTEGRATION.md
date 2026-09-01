# FE-INTEGRATION — Panduan Konsumsi API untuk Tim FE Landing Page SGA

**Versi:** 1.0
**Tanggal:** 2 September 2026
**Base URL produksi:** `https://bph-cms.sga-cakrawala.org/api/v1`
**Base URL dev panel:** `http://localhost:8791/api/v1` (via proxy Vite)
**Dokumen terkait:** [SDD.md §4](./SDD.md) (contract final) · [PRD.md](./PRD.md) · [PANEL-UI.md](./PANEL-UI.md)

Dokumen ini untuk tim FE `sga-landing-page`: endpoint yang tersedia, bentuk data, konten & aset yang diharapkan ada di halaman detail event, tombol Google Calendar, dan dummy JSON untuk mulai koding tanpa nunggu backend.

---

## 1. Aturan Umum (ekosistem 3 CMS)

1. **Response wrapper seragam** semua CMS SGA:

```json
// sukses
{ "success": true, "message": "OK", "statusCode": 200, "data": ... }
// error
{ "success": false, "message": "...", "statusCode": 422, "errors": { "field": ["pesan"] } }
```

2. **Semua timestamp ISO 8601 dengan offset** (`2026-09-10T08:00:00+07:00`). Tampilkan selalu WIB.
3. FE LP **hanya konsumen GET publik** — tidak ada endpoint tulis untuk FE.
4. Status `ongoing/upcoming/past` **dihitung server** — jangan hitung ulang sendiri di list (konsistensi).

## 2. Endpoint Publik (tanpa auth)

### 2.1 `GET /events?status=&limit=&page=`

- `status`: `ongoing` | `upcoming` | `past` (opsional)
- `limit`: default 12, max 50 · `page`: default 1
- Sortir sudah benar dari server: ongoing di atas → upcoming terdekat → past terbaru.
- Response `data`:

```json
{
  "items": [
    {
      "id": "0192…",
      "slug": "cakrawala-festival-2026",
      "title": "Cakrawala Festival 2026",
      "description": "…",
      "cover_image_url": "https://bph-cms.sga-cakrawala.org/api/v1/storage/covers/….jpg",
      "starts_at": "2026-09-10T08:00:00+07:00",
      "ends_at": "2026-09-11T17:00:00+07:00",
      "location": "Cakrawala University, Kampus Kemang",
      "location_url": "https://maps.google.com/…",
      "registration_url": "https://…",
      "registration_open": true,
      "organizer": "BEM",
      "status": "upcoming"
    }
  ],
  "meta": { "current_page": 1, "total": 24, "per_page": 12 }
}
```

- List **tidak** menyertakan `sessions` — ambil dari detail.

### 2.2 `GET /events/:slug`

Detail + `sessions[]` urut `starts_at`. 404 bila draft/tidak ada — jangan render halaman untuk draft.

```json
{
  "id": "0192…",
  "slug": "cakrawala-festival-2026",
  "title": "Cakrawala Festival 2026",
  "description": "Acara tahunan…",
  "cover_image_url": "…",
  "starts_at": "2026-09-10T08:00:00+07:00",
  "ends_at": "2026-09-11T17:00:00+07:00",
  "location": "Cakrawala University, Kampus Kemang",
  "location_url": "https://maps.app.goo.gl/…",
  "registration_url": "https://forms.gle/…",
  "registration_open": true,
  "organizer": "BPH SGA",
  "sessions": [
    {
      "id": "0193…",
      "name": "Seminar Teknis: AI di Industri",
      "starts_at": "2026-09-10T13:00:00+07:00",
      "ends_at": "2026-09-10T15:00:00+07:00",
      "speaker": "Nama Pemateri",
      "location": "Auditorium Lt. 2",
      "description": "Membahas penerapan AI…"
    }
  ]
}
```

### 2.3 `GET /events/calendar?month=YYYY-MM`

Event (published) yang rentangnya beririsan dengan bulan tsb — event multi-hari tetap masuk. Untuk komponen kalender bulanan di portal.

```json
{ "items": [ { "slug": "…", "title": "…", "starts_at": "…", "ends_at": "…", "location": "…" } ] }
```

## 3. Konten & Aset Halaman Detail (`/events/:slug`)

Halaman detail = target share link WA/IG. Susunan blok yang dibutuhkan (atas ke bawah):

| Blok | Sumber field | Catatan |
|---|---|---|
| Cover besar | `cover_image_url` | rasio 16:9 disarankan; sediakan fallback gradient + inisial event bila null |
| Judul + penyelenggara | `title`, `organizer` | |
| Badge status | hitung dari waktu (atau `status` di list) | "Sedang Berlangsung" / "Akan Datang" / "Selesai" |
| Waktu | `starts_at`, `ends_at` | format: "10–11 Sep 2026 · 08:00–17:00 WIB" |
| Lokasi + tombol maps | `location`, `location_url` | tombol "Lihat Lokasi" hanya bila `location_url` ada |
| Deskripsi | `description` | paragraf bebas, aman dirender sebagai teks (escape HTML) |
| **Timeline runsheet** | `sessions[]` | render vertikal per sesi: jam (HH:MM–HH:MM WIB), nama, pemateri, ruang, catatan — lihat §4 |
| Tombol **Daftar** | `registration_url` + `registration_open` | hanya render bila keduanya terpenuhi; jika `registration_open=false` tampilkan "Pendaftaran ditutup" |
| Tombol **Tambah ke Google Calendar** | template URL §5 | selalu tersedia |
| Tombol **Bagikan** | Web Share API | fallback copy link |

**Aset statis yang perlu disiapkan FE sendiri** (tidak dari API): ikon kalender/lokasi/jam/pemateri, placeholder cover, og-image default (bila cover null, og pakai branded default).

## 4. Render Timeline Runsheet

```
08:00 ──┐ Pembukaan & registrasi ulang · Lobby
09:00 ──┤ Seminar Teknis: AI di Industri · Auditorium — Pemateri: Nama
         "Membahas penerapan AI…"
13:00 ──┤ …
```

- Urut `starts_at` (sudah dari server).
- Sesi lintas hari: tampilkan tanggal + jam.
- `speaker`, `location`, `description` **nullable** — sembunyikan baris kosong, jangan render "null".
- Highlight sesi yang sedang berjalan (now di antara `starts_at`–`ends_at`) bila event berlangsung.

## 5. Tambah ke Google Calendar (tanpa backend)

Template URL resmi — buka di tab baru:

```
https://calendar.google.com/calendar/render?action=TEMPLATE
  &text={title}
  &dates={YYYYMMDDTHHMMSSZ}/{YYYYMMDDTHHMMSSZ}   ← UTC, konversi dari ISO offset
  &details={description pendek + link detail}
  &location={location}
```

Contoh untuk `2026-09-10T08:00:00+07:00` → `20260910T010000Z`. Semua parameter wajib URL-encoded.

## 6. Pola Fetch, Error & Cache (acuan: `src/components/reporting/form.tsx`)

- fetch → cek `body.success` → pakai `body.data`; error → tampilkan `body.message` (+ `errors` bila ada).
- 404 detail → halaman "Event tidak ditemukan / sudah berakhir".
- 429 → sedikit request; jangan retry loop.
- Cache: data publik aman di-cache klien (mis. SWR/tanpa store) maksimal 60 detik — perubahan publish butuh < 1 menit terlihat.
- Gambar cover dari `/api/v1/storage/*` dibalut `Cache-Control: immutable` — aman di-cache browser selamanya (URL unik per upload).

## 7. Uji Coba Lokal

```bash
# jalankan BE
npm run dev   # bph-cms di :8791

# contoh
curl http://localhost:8791/api/v1/events
curl "http://localhost:8791/api/v1/events/calendar?month=2026-09"
```

Env FE: `VITE_BPH_API_URL=https://bph-cms.sga-cakrawala.org/api/v1` (dev: `http://localhost:8791/api/v1`).

OpenAPI spec hidup: `GET /api/v1/openapi` · UI Scalar: `/api/v1/reference`.
