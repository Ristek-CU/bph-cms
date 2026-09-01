# QPR-PRD — Modul Penilaian Internal SGA (QPR)

**Versi:** 0.1 (draft awal — belum final, menunggu konfirmasi pemangku kepentingan BPH)
**Tanggal:** 2 September 2026
**Status:** Konsep + alur + wireframe teks. Schema DB & endpoint menyusul di SDD setelah PRD ini disetujui.
**Dokumen terkait:** [PRD.md](./PRD.md) · [PANEL-UI.md](./PANEL-UI.md)

---

## 1. Apa itu QPR

QPR adalah **formulir penilaian kinerja internal SGA**. Dipakai untuk menilai:

- **anggota** divisi (dinilai oleh ketua divisi masing-masing), dan
- **ketua divisi** (dinilai oleh anggota divisi masing-masing).

Karakeristik kunci — beda dari form publik (Student Voice / advokasi):

1. **Internal & berbasis login.** Hanya akun SGA (service `auth` superapp) yang bisa mengisi. Tidak ada akses publik.
2. **Terarah per penilai.** Setiap responden menilai orang tertentu yang sudah ditugaskan — bukan form terbuka bebas.
3. **Berperiodе.** Penilaian berjalan per periode (mis. per bulan/semester) dengan tanggal buka–tutup.
4. **Hasil direkap** untuk pimpinan (BPH) — bukan sekadar kumpulan jawaban.

> **Butuh konfirmasi BPH (blokir sebelum SDD):** kepanjangan QPR, periode penilaian (bulanan/semester), siapa saja pasangan penilai–dinilai (atasan→bawahan saja, atau juga sebaliknya/tim sejawat), apakah hasil dinilai anonim bagi yang dinilai, dan bobot penilaian (angka 1–5, bobot per kategori, atau narasi saja).

## 2. Peran

| Peran | Akses |
|---|---|
| Admin BPH | Buat/edit form penilaian, atur periode, atur penugasan penilai–dinilai, lihat semua rekap |
| Ketua divisi | Isi penilaian untuk anggota divisinya; lihat rekap divisinya |
| Anggota | Isi penilaian untuk ketua divisinya |

Mapping peran memakai data user di service `auth` superapp (role + divisi). CMS BPH tidak membuat tabel user sendiri (aturan CONTEXT §2).

## 3. Alur Penggunaan

### 3.1 Admin BPH menyiapkan

1. Buka modul QPR → **Periode** aktif ditampilkan (mis. "Penilaian September 2026 · buka 25–30 Sep").
2. Buat **Form penilaian**: nama, kategori pertanyaan (mis. Kinerja, Kolaborasi, Inisiatif), tipe pertanyaan (skala 1–5, pilihan, teks).
3. Atur **Penugasan**: sistem membuat pasangan penilai→dinilai dari struktur divisi; admin bisa sesuaikan manual.
4. **Buka periode** → notifikasi ke pengisi (fase lanjut; v1 cukup info di grup).

### 3.2 Pengisi menilai

1. Login panel → modul QPR → tampil daftar "orang yang harus kamu nilai" + status (belum/selesai).
2. Klik satu nama → form penilaian (§4.3) → kirim → status jadi selesai.
3. Boleh revisi selama periode masih terbuka.

### 3.3 Pimpinan melihat rekap

1. Halaman Rekap: pilih periode → ringkasan skor rata-rata per orang/kategori.
2. Detail per orang: rata-rata per kategori + komentar (anonim bila kebijakan menetapkan).
3. (Fase lanjut) Ekspor CSV/Excel.

## 4. Wireframe Teks

### 4.1 List Periode (halaman utama QPR)

```
QPR — Penilaian Internal
┌────────────────────────────────────────────┐
│ Penilaian September 2026       [Berlangsung]│
│ 25–30 Sep 2026 · 18/24 penugasan selesai    │
│ [Rekap] [Edit form] [Kelola penugasan]      │
├────────────────────────────────────────────┤
│ Penilaian Agustus 2026          [Selesai]   │
│ [Rekap]                                     │
└────────────────────────────────────────────┘
[+ Periode baru]
```

### 4.2 Halaman "Nilai Sekarang" (untuk pengisi)

```
Penilaian kamu — periode September 2026
┌────────────────────────────────────┐
│ 1. Raka Pratama — Anggota Ristek    │
│    [Belum dinilai]  [Nilai →]       │
│ 2. Sinta Dewi — Anggota Ristek      │
│    [Selesai ✓]      [Lihat]         │
└────────────────────────────────────┘
Batas pengisian: 30 Sep 2026, 23:59 WIB
```

### 4.3 Form Penilaian

```
Menilai: Raka Pratama (Anggota Ristek)
Kategori: Kinerja
┌──────────────────────────────────────────┐
│ Menyelesaikan tugas tepat waktu           │
│ ( ) 1  ( ) 2  (●) 3  ( ) 4  ( ) 5         │
│ 1 = sangat kurang · 5 = sangat baik       │
├──────────────────────────────────────────┤
│ Kategori: Kolaborasi                      │
│ … pertanyaan berikutnya …                 │
├──────────────────────────────────────────┤
│ Catatan untuk yang dinilai (opsional)     │
│ [textarea]                                │
└──────────────────────────────────────────┘
[Kirim Penilaian]
```

### 4.4 Rekap (admin)

```
Rekap — September 2026
┌───────────────────────────────────────────────┐
│ Nama           Kinerja  Kolaborasi  Inisiatif  │
│ Raka Pratama      4,2       3,8        4,0     │
│ Sinta Dewi        3,5       4,1        3,9     │
└───────────────────────────────────────────────┘
Klik nama → detail per kategori + komentar
```

## 5. Batasan v1 (diusulkan)

- Tipe pertanyaan: skala 1–5 + teks saja (pilihan ganda menyusul — YAGNI sampai diminta).
- Penugasan dibuat manual/semi-otomatis (dari struktur divisi) — tanpa integrasi HR.
- Tidak ada notifikasi otomatis (email/push) — pengumuman lewat grup internal.
- Rekap = rata-rata sederhana; bobot berbagan menyusul bila diminta.

## 6. Langkah Berikutnya

1. BPH konfirmasi pertanyaan terbuka di §1.
2. Tulis SDD modul QPR: schema D1 (`qpr_periods`, `qpr_forms`, `qpr_questions`, `qpr_assignments`, `qpr_answers`), endpoint, validasi.
3. Implement BE → panel UI (mengikuti kerangka [PANEL-UI.md](./PANEL-UI.md)).
