# Checklist implementasi perbaikan QPR

Rancangan: [plan.md](plan.md). Prompt: [qpr-prompt.md](qpr-prompt.md).
Semua tugas di bawah belum diimplementasikan. S = 1–2 file, M = 3–5 file.
Nama file baru adalah usulan; cocokkan pola repositori sebelum membuatnya.
Jika cakupan melampaui lima file atau satu sesi fokus, pecah tugas sebelum mulai.
Keputusan akses belum final; tugas yang bergantung padanya menunggu keputusan,
sedangkan pemeriksaan status, setup, dan navigasi dapat dikerjakan terpisah.

## T0 — Tetapkan kontrak produk

Deskripsi: catat model akses terpilih, pemetaan identitas, hak pembaca komentar,
kontrak deadline, serta perlakuan periode aktif dan historis.

- [ ] Satu model akses dipilih; prasyarat akun individual atau distribusi token terbukti tersedia.
- [ ] Matriks hak akses dan status/transisi disepakati; final tetap immutable kecuali ada keputusan baru.
- [ ] Kampanye aktif memiliki strategi kompatibilitas eksplisit; tidak dimigrasikan berdasarkan tebakan nama.

Verifikasi: review keputusan terhadap route/service aktual dan contoh satu pengisi
per jabatan. Dependensi: tidak ada. File: `tasks/plan.md`, `tasks/todo.md`. Ukuran: S.

## T1 — Samakan status efektif periode

Deskripsi: server mengembalikan status tampilan berdasarkan status dasar dan waktu;
admin serta pengisi memakai kontrak yang sama.

- [ ] Terjadwal, Berlangsung, dan Ditutup sesuai waktu server; tutup manual mengalahkan jadwal.
- [ ] UI menampilkan jadwal WIB dan pesan belum mulai/ditutup yang dapat dibedakan.
- [ ] Aturan detik batas dan jadwal invalid teruji sesuai keputusan T0.

Verifikasi: `npx tsx src/qpr.test.ts`, smoke periode sebelum/saat/setelah batas.
Dependensi: kontrak waktu T0. File: `src/modules/qpr/qpr.service.ts`,
`src/modules/qpr/qpr.route.ts`, `src/qpr.test.ts`, `panel/src/pages/Qpr.jsx`,
`panel/src/pages/QprFill.jsx`. Ukuran: M.

### Checkpoint 1

- [ ] Keputusan yang belum ada tetap ditandai; tidak diasumsikan sebagai persetujuan.
- [ ] Perubahan status lolos tes terfokus, typecheck, dan build panel sebelum dilanjutkan.

## T2 — Siapkan data identitas terverifikasi

Deskripsi: tambahkan representasi identitas sesuai satu model terpilih, tanpa
mengubah jawaban/ID historis. Jika model lama dipertahankan, jangan menambah skema tanpa kebutuhan.

- [ ] Mapping satu identitas ke satu entry per periode tidak mengandalkan nama; nama kembar didukung.
- [ ] Migrasi bersifat aditif dan kompatibel dengan periode lama; mapping belum lengkap terlihat jelas.
- [ ] Jika memakai token, hash disimpan dan rotasi/pencabutan diuji; token mentah tidak masuk log.

Verifikasi: uji migrasi pada salinan fixture D1 dan tes constraint/mapping.
Dependensi: T0. File: `src/db/schema.ts`, satu file migrasi baru sesuai konvensi,
satu modul identitas QPR baru, satu file tes identitas baru. Ukuran: M.

## T3 — Terapkan kebijakan akses di seluruh endpoint

Deskripsi: terapkan identitas server pada baca/tulis draft, submit, dan pembacaan
status final; endpoint lama tidak boleh melewati kebijakan periode baru.

- [ ] Pengisi tidak dapat membaca/mengubah entry orang lain dengan mengganti ID bila memakai model akses terlindungi.
- [ ] Seluruh route lama dan baru memakai kebijakan periode yang sama; hak BPH/divisi tetap terpisah.
- [ ] Akses kedaluwarsa/dicabut/salah periode ditolak, tanpa membocorkan jawaban.

Verifikasi: `npx tsx src/qpr.test.ts` dan tes identitas T2, termasuk route bypass.
Dependensi: T2. File: `src/modules/qpr/qpr.route.ts`,
`src/modules/qpr/qpr.service.ts`, modul identitas T2, `src/qpr.test.ts`. Ukuran: M.

## T4 — Perjelas masuk dan identitas pengisi

Deskripsi: UI memakai model akses terpilih, menunjukkan identitas serta status
pengisian sebelum mulai, dan menyediakan penanganan akses invalid.

- [ ] Identitas berasal dari server untuk model terlindungi; pilihan nama bebas tidak menjadi bukti identitas.
- [ ] Mulai, lanjutkan draft, dan sudah dikirim memiliki tujuan yang jelas; akses invalid memberi petunjuk pemulihan.
- [ ] Pesan privasi sesuai model nyata; link pribadi yang diteruskan tidak diklaim mencegah penyamaran.

Verifikasi: tes UI rute publik dan pengisi, smoke akses baru/lama/tidak valid.
Dependensi: T1, T3. File: `panel/src/pages/QprFill.jsx`,
`panel/tests/qpr-public-route.spec.js`, `panel/tests/qpr-fill.spec.js`. Ukuran: M.

### Checkpoint 2

- [ ] Alur akses sampai draft berjalan end-to-end dengan fixture dan isolasi entry terbukti.
- [ ] Kampanye lama tetap berperilaku sesuai kebijakan; perubahan akses siap ditinjau sebelum migrasi nyata.

## T5 — Permudah tambah pengisi

Deskripsi: berikan form nama, divisi, dan jabatan berlabel jelas, menggunakan
ID stabil; pilih sumber anggota terverifikasi hanya bila memang tersedia.

- [ ] Admin tidak perlu mengetik slug/jabatan teknis untuk penambahan biasa.
- [ ] Nama kembar tidak tergabung; ID anggota stabil dan mapping akun tidak ditebak.
- [ ] Form menampilkan error validasi dan menolak perubahan roster setelah pertama dibuka.

Verifikasi: `npm --prefix panel run test:ui -- tests/qpr-admin.spec.js` serta
tes server roster yang berubah bila diperlukan. Dependensi: T0; T2 jika memetakan akun.
File: `panel/src/pages/QprEditor.jsx`, komponen roster baru,
`src/modules/qpr/qpr.schema.ts`, `panel/tests/qpr-admin.spec.js`, `src/qpr.test.ts`.
Ukuran: M.

## T6 — Impor dengan preview yang dapat diperiksa

Deskripsi: tambahkan CSV dengan pemetaan kolom, preview tambah/perbarui/konflik,
dan pesan kesalahan per baris. Gunakan jalur impor server yang sudah ada.

- [ ] Admin melihat hasil pemetaan sebelum commit; input invalid tidak menghasilkan impor parsial.
- [ ] Impor ulang dengan ID yang sama memperbarui entry tanpa duplikasi; nomor baris bukan ID.
- [ ] Format file salah, nama kembar, dan roster terkunci ditangani tanpa kehilangan input.

Verifikasi: tes parser CSV terfokus, `npx tsx src/qpr.test.ts`, tes UI admin.
Dependensi: T5. File: komponen roster T5, parser CSV baru beserta tesnya,
`src/qpr.test.ts`, `panel/tests/qpr-admin.spec.js`. Ukuran: M.

## T7 — Pandu kesiapan publikasi

Deskripsi: tambahkan checklist setup dan perbaiki preview/readiness memakai
resolver yang sama dengan pengisian nyata.

- [ ] Checklist mengarahkan admin ke bagian yang belum siap tanpa membuang edit lokal.
- [ ] Preview menampilkan jalur serta jumlah pertanyaan aktual per pengisi; tidak menyimpan respons.
- [ ] Publikasi memvalidasi ulang versi snapshot/roster dan menjelaskan penguncian permanen, termasuk jadwal mendatang.

Verifikasi: tes UI admin dan backend readiness; uji dua tab mengubah roster saat publikasi.
Dependensi: T1, T6. File: `panel/src/pages/QprEditor.jsx`,
`src/modules/qpr/qpr.service.ts`, `src/qpr.test.ts`, `panel/tests/qpr-admin.spec.js`.
Ukuran: M.

### Checkpoint 3

- [ ] BPH dapat membuat periode → impor → preview seluruh jabatan → publikasi memakai data uji.
- [ ] Routing, ID pertanyaan, freeze, dan snapshot legacy tetap lolos regresi.

## T8 — Navigasi bagian dan review

Deskripsi: perjelas target yang sedang dinilai, kelengkapan tiap bagian,
perpindahan ke pertanyaan kosong, serta kembali dari review untuk memperbaiki jawaban.

- [ ] Navigator menunjukkan kelengkapan required, posisi aktif, dan target dengan label jelas.
- [ ] Pengisi dapat memperbaiki bagian dari review lalu kembali; jawaban tetap terjaga.
- [ ] Tampilan 320 px dan navigasi keyboard tidak tertutup footer atau memotong kontrol.

Verifikasi: `npm --prefix panel run test:ui -- tests/qpr-stepped.spec.js tests/qpr-fill.spec.js`.
Dependensi: tidak bergantung pada model akses; integrasi akhir memakai T4.
File: `panel/src/pages/QprFill.jsx`, `panel/src/components/QprForm.jsx`,
`panel/tests/qpr-stepped.spec.js`, `panel/tests/qpr-fill.spec.js`. Ukuran: M.

## T9 — Perjelas simpan, konflik, dan keluar

Deskripsi: sempurnakan kontrak autosave yang sudah ada dan aksi Simpan & keluar;
jangan menambah cache jawaban sensitif persisten tanpa keputusan produk.

- [ ] Tersimpan hanya tampil setelah acknowledgment server; keluar menunggu flush berhasil.
- [ ] Offline/error menyediakan retry; konflik tidak diam-diam menimpa versi perangkat lain.
- [ ] Deadline/penutupan saat mengisi mempertahankan teks lokal selama halaman masih terbuka dan menjelaskan bahwa kiriman belum tersimpan.

Verifikasi: tes UI pengisi dengan jaringan gagal dan konflik dua perangkat,
`npm --prefix panel run test:qpr-integration`.
Dependensi: T1, T8. File: `panel/src/pages/QprFill.jsx`,
`panel/tests/qpr-fill.spec.js`, `panel/tests/qpr-integration.spec.js`. Ukuran: M.

### Checkpoint 4

- [ ] Pengisi dapat resume → edit → review tanpa kehilangan jawaban yang diakui tersimpan.
- [ ] Offline, konflik, ganti bagian, dan keluar memiliki perilaku yang dapat dijelaskan dan diuji.

## T10 — Bukti final dan retry aman

Deskripsi: lengkapi hasil submit dengan status final dan waktu WIB milik entry
yang berhak, memakai mekanisme atomik yang sudah tersedia.

- [ ] Double-click/retry tidak membuat dua respons; final tidak dapat diedit.
- [ ] Timeout setelah commit dapat dipulihkan menjadi bukti kirim yang sama melalui status server.
- [ ] Bukti tidak membocorkan jawaban/identitas entry lain dan tetap dapat diakses pemilik setelah penutupan sesuai kebijakan T0.

Verifikasi: backend double-submit dan commit-then-network-failure; tes integrasi pengisi.
Dependensi: T3, T4, T9. File: `src/modules/qpr/qpr.route.ts`,
`src/modules/qpr/qpr.service.ts`, `panel/src/pages/QprFill.jsx`,
`src/qpr.test.ts`, `panel/tests/qpr-integration.spec.js`. Ukuran: M.

## T11 — Pantau partisipasi sesuai hak akses

Deskripsi: tampilkan belum mulai/draft/final dengan batas privasi yang disepakati;
angka completion hanya menghitung final.

- [ ] BPH melihat progres; divisi hanya melihat roster miliknya dan status yang diizinkan.
- [ ] Tidak ada isi jawaban, komentar, atau token di API pemantauan divisi.
- [ ] Status periode sesuai T1; filter, empty state, dan hitungan tetap konsisten.

Verifikasi: uji akses lintas divisi dan hitungan draft/final; smoke admin dan akun divisi.
Dependensi: T0, T1, T10. File: `src/modules/qpr/qpr.route.ts`,
`src/modules/qpr/qpr.service.ts`, `panel/src/pages/Qpr.jsx`,
`src/qpr.test.ts`, `panel/tests/qpr-admin.spec.js`. Ukuran: M.

## T12 — Rekap yang dapat ditafsirkan

Deskripsi: audit agregasi/ekspor yang ada dan tampilkan konteks snapshot serta
jumlah respons per pertanyaan, tanpa mengubah rumus resmi secara sepihak.

- [ ] Hanya final masuk rekap; N valid per pertanyaan jelas dan data kosong tidak menjadi nol.
- [ ] Snapshot/target berbeda tidak dicampur menjadi satu rata-rata tanpa aturan yang disepakati.
- [ ] Komentar/ekspor mengikuti izin BPH dan tidak membuka jawaban melalui endpoint alternatif.

Verifikasi: fixture dengan pertanyaan opsional kosong dan beberapa snapshot,
`npx tsx src/qpr.test.ts`, smoke tab Respons dan ekspor yang tersedia.
Dependensi: T0, T10. File: `src/modules/qpr/qpr.service.ts`,
`src/modules/qpr/qpr.route.ts`, `panel/src/pages/QprEditor.jsx`,
`src/qpr.test.ts`, `panel/tests/qpr-admin.spec.js`. Ukuran: M.

### Checkpoint 5

- [ ] BPH → pengisi → final → partisipasi → rekap konsisten dalam satu skenario penuh.
- [ ] Seluruh jabatan dan format legacy/v2/v3 terwakili; hasil rekap dapat ditelusuri ke fixture final.

## T13 — Uji kompatibilitas dan pemulihan

Deskripsi: tulis serta jalankan rehearsal migrasi dan rollback pada lingkungan
terpisah; dokumentasikan perlakuan kampanye aktif sebelum perubahan production.

- [ ] Backup dapat dipulihkan; jumlah/ID jawaban historis tidak berubah setelah migrasi.
- [ ] Versi kode rollback kompatibel dengan data baru dan tidak membuka jalur bypass akses.
- [ ] Pilot satu periode uji dan indikator kegagalan ditentukan; log tidak memuat jawaban/token.

Verifikasi: rehearsal D1 lokal/staging dengan data sintetis atau salinan yang aksesnya
diizinkan; simpan hasil, bukan data sensitif. Dependensi: T2–T12 yang berlaku.
File: runbook QPR baru di `docs/reviews/`, skrip rehearsal baru sesuai konvensi proyek.
Ukuran: S. Tidak menjalankan migrasi production dalam tugas ini.

## T14 — Smoke akhir dan bukti hasil

Deskripsi: periksa alur lengkap pada viewport 320/390/768/1024/1440 px, keyboard,
loading/empty/error, serta komponen bersama yang terkena perubahan.

- [ ] Setiap temuan memiliki reproduksi, perbaikan, dan bukti tes/screenshot yang relevan.
- [ ] Seluruh tes wajib, typecheck, build, dan lint lulus atau memiliki baseline yang dijelaskan; tidak ada regresi baru yang dibiarkan.
- [ ] Laporan merinci cakupan, batas pengujian, keputusan tersisa, serta kesiapan pilot/deploy tanpa klaim keamanan mutlak.

Verifikasi: `npm test`, `npm run typecheck`, `npm --prefix panel run build`,
`npm --prefix panel run lint`, `npm --prefix panel run test:ui`,
`npm --prefix panel run test:qpr-integration`. Jalankan suite luas setelah perubahan
terintegrasi; jangan mengulang seluruh suite setelah setiap perbaikan kecil.
Dependensi: T13. File: laporan QPR baru di `docs/reviews/`,
`panel/tests/qpr-admin.spec.js`, `panel/tests/qpr-fill.spec.js`,
`panel/tests/qpr-stepped.spec.js`, `panel/tests/qpr-integration.spec.js`. Ukuran: M.

### Checkpoint 6 — Siap ditinjau

- [ ] Acceptance criteria yang berlaku selesai; bukti verifikasi ditautkan.
- [ ] Flow dan pilihan produk ditinjau sebelum peluncuran; perencanaan ini sendiri tidak menjalankan push/deploy.
