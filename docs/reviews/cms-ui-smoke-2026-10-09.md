# Pemeriksaan UI lanjutan — 9 Oktober 2026

Pemeriksaan ini melanjutkan [review flow CMS](cms-flow-review-2026-10-09.md).
Fokusnya tampilan browser dan interaksi pengguna. Kode belum di-deploy.

## Cara pemeriksaan

- Chromium lokal melalui Playwright; data fixture tanpa mengubah data produksi.
- 13 halaman pada lebar 1440, 1024, 768, 390, dan 320 px: Ringkasan, daftar/
  kalender/editor Event, daftar/detail/editor/kalender Internal Event, daftar/
  builder/analitik Form, Akun, dan Oversight Roro.
- Lima bagian workspace QPR pada lebar 1440, 390, dan 320 px, termasuk mengedit
  dan menyimpan pertanyaan.
- Screenshot bagian atas dan bawah **pane yang benar-benar bisa discroll**.
  Screenshot full-page saja tidak merekam bagian bawah pane CMS.
- Data judul dan jawaban panjang; grafik polling terisi; empty state, error/retry,
  pencarian, menu keyboard, resize drawer, dan modal konfirmasi 320 × 568 px.
- Pemeriksaan DOM untuk overflow dan label kontrol; pengumpulan exception dan
  console error pada scan halaman terisi. Screenshot diperiksa secara visual
  untuk temuan layout; tidak menggunakan pixel snapshot sebagai satu-satunya bukti.

## Temuan dan perubahan

| Temuan | Perubahan | Verifikasi |
| --- | --- | --- |
| Menu mobile yang masih terbuka membuat konten desktop tetap `inert` setelah resize | Tutup drawer saat masuk breakpoint desktop; lepaskan focus trap dan inert | Tes sebelum fix gagal saat mengklik konten desktop; sesudah fix berhasil |
| Kartu Form sekitar 190 px pada laptop 1024 px meskipun ada ruang kosong | Grid mengikuti lebar kontainer dan jumlah kartu | Scan lima ukuran, batas minimal lebar kartu, screenshot |
| Label isian berikutnya menempel pada input sebelumnya di editor Event | Komponen Field mempunyai jarak vertikal eksplisit, termasuk grid jadwal | Pemeriksaan jarak minimal 16 px dan screenshot editor publik/internal |
| Upload cover masih berupa kontrol default tanpa penataan | Gaya input file, batas lebar, dan tombol pemilih disamakan dengan panel | Screenshot desktop/mobile dan scan overflow |
| Tombol aksi detail Event/QPR berdempetan | Baris aksi mempunyai gap dan wrapping; footer modal tetap penuh pada mobile | Screenshot detail, tab QPR, dan pemeriksaan lebar tombol modal |
| Petunjuk susunan pertanyaan terpecah menjadi kolom di layar kecil | Teks mengalir sebagai paragraf dengan ikon inline | Screenshot Form Builder 320 px |
| Bar simpan QPR mengambang jauh di atas tepi bawah karena padding halaman | Kurangi padding footer khusus workspace/builder dan beri ruang scroll untuk kontrol | Posisi bar maksimal 24 px dari bawah; edit dan simpan pertanyaan di tiga ukuran |
| Tab terakhir QPR tersembunyi di belakang scroll horizontal mobile | Tab ditata dalam dua baris pada layar kecil | Seluruh lima tab dapat dipilih di 390/320 px |
| Escape pada pemilih tipe Form membatalkan edit pertanyaan dan membuang teks | Tangani Escape hanya pada menu terbuka; kembalikan fokus; tambah navigasi panah/Home/End/Enter | Tes direproduksi gagal sebelum fix, kemudian mempertahankan teks dan memilih tipe via keyboard |
| Baris pertanyaan tetap penuh tombol nonaktif ketika sedang diedit | Sembunyikan aksi baris yang sedang diedit; pertahankan Batal/Selesai | Smoke editor pada layar 320 × 568 px |
| Navigasi Daftar/Kalender Internal hilang setelah membuka kalender | Komponen navigasi bersama dengan status halaman aktif yang benar | Navigasi bolak-balik melalui link dan pemeriksaan `aria-current` |
| Kalender kosong menawarkan pembuatan kepada pengguna read-only | Tampilkan CTA hanya bila mempunyai hak membuat event | Fixture read-only tidak mendapat CTA |

Label “Analytics” diseragamkan menjadi “Analitik”; angka dan label hitungan Form
memiliki jarak eksplisit. Tombol Ganti dashboard juga mengikuti guard edit belum
disimpan yang sudah digunakan tombol kembali/keluar.

## Validasi

- Suite browser lengkap: **84 skenario lolos**, termasuk 12 smoke/regresi baru,
  dalam 2,6 menit. Tes integrasi draft publik/internal melalui Worker lokal juga lolos.
- Build produksi dan typecheck: exit 0.
- Lint: exit 0, tidak ada error, 28 warning React yang sudah ada sebelumnya.
- `git diff --check`: bersih.

Screenshot dan log pemeriksaan tersedia lokal di `/private/tmp/bph-ui-scan`
dan `/private/tmp/bph-ui-final.log`. Jalankan ulang dengan
`UI_SCAN_DIR=/private/tmp/bph-ui-scan npm --prefix panel run test:ui` setelah
membuat direktori screenshot tersebut.

Ini bukan pengujian perangkat iOS/Android fisik atau Safari/Firefox. Data produksi,
layanan auth asli, dan provider AI asli tidak dipakai dalam scan ini. Batas keamanan
dari review sebelumnya tetap berlaku.
