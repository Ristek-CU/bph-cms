# Prompt implementasi perbaikan flow QPR

Salin prompt berikut ke agent yang akan mengerjakan. Keputusan model akses pada
`tasks/plan.md` masih perlu diisi sesuai pilihan pemilik produk.

```text
Kamu bekerja di repo /Users/mekari/ristek/bph-cms. Tugasmu memperbaiki flow QPR
secara mendalam, dari setup BPH sampai pengisian dan rekap. Baca tasks/plan.md
dan tasks/todo.md sebagai rancangan awal, lalu cocokkan dengan kode terbaru.

Jangan langsung merombak UI. Petakan flow yang sudah ada, buktikan bug konkret,
bedakan bug dari keputusan produk, dan pertahankan fungsi yang sudah benar.
Utamakan QPR; perbaikan komponen bersama harus diuji terhadap modul CMS lain.

Sumber utama:
- panel/src/pages/Qpr.jsx, QprEditor.jsx, QprFill.jsx
- panel/src/components/QprForm.jsx
- src/modules/qpr/qpr.route.ts, qpr.service.ts, qpr.schema.ts, qpr.templates.ts
- src/db/schema.ts, drizzle/, src/qpr.test.ts, panel/tests/qpr-*.spec.js
- docs/reviews/cms-flow-review-2026-10-09.md
- docs/reviews/cms-ui-smoke-2026-10-09.md

Target flow BPH:
Daftar periode → buat draft → identitas/jadwal → target dan pertanyaan → pengisi
→ preview sesuai jabatan → pemeriksaan kesiapan → buka/jadwalkan → pantau
→ tutup → rekap. Buat checklist setup yang dapat dilanjutkan. Impor pengisi
harus mudah, memakai ID stabil, punya preview dan error per baris. Jangan meminta
admin mengetik slug/member_key pada flow utama. Nama kembar tidak boleh digabung.

Target flow pengisi:
Buka periode → validasi status/akses → identitas dan ringkasan → mulai/lanjut draft
→ isi per target → autosave dan progres → review → konfirmasi final → bukti kirim.
Sediakan pemulihan untuk gagal simpan, konflik, deadline, dan timeout setelah kirim.
Tersimpan hanya ditampilkan setelah revisi terakhir diakui server. Jangan membuang
isian karena navigasi, error, atau Escape pada popup. Submit harus tepat satu kali
secara data; retry setelah respons jaringan hilang tidak membuat duplikasi.

Target flow divisi:
Login → pilih periode → lihat partisipasi divisinya → cari/filter pengisi.
Tidak boleh membuka nilai, komentar, atau akses pribadi pengisi lain.

Keputusan akses pengisi belum final. Cocokkan dengan jawaban pemilik produk:
login individual, link pribadi, atau model kejujuran yang sekarang. Jangan mengubah
akses kampanye aktif berdasarkan asumsi. Rekomendasi login hanya berlaku jika
semua pengisi mempunyai akun individual, bukan akun divisi bersama. Link pribadi
bukan bukti identitas orang bila diteruskan. Jika tetap pilih nama tanpa login,
jelaskan batas keamanan; jangan mengklaim draft rahasia atau identitas terverifikasi.
Tahan perubahan yang bergantung pada keputusan ini, sambil lanjutkan pekerjaan
independen yang jelas. Jangan membuat semua alternatif sekaligus.

Aturan yang wajib dipertahankan:
- Routing resmi di qpr.templates.ts; jangan menebak aturan penilaian baru.
- Kadiv/Wakadiv menilai empat Controller + Ketua/Wakil; Bendiv menilai dua Bendum
  + Ketua/Wakil; Sekdiv menilai dua Sekum + Ketua/Wakil. Verifikasi role lainnya
  dari resolver. Snapshot historis memakai routing historisnya sendiri.
- Snapshot dan roster terkunci setelah pertama dibuka; menutup lalu membuka
  kembali tidak membuka kunci. Final tidak dapat diedit tanpa desain revisi khusus.
- Autosave, CAS version, resume, dan submit atomik yang sudah ada dipertahankan.
- Legacy/v2/v3 tetap kompatibel; jangan hapus jawaban, ubah ID, atau reset data.
- Status UI, API, dan jadwal WIB harus sepakat. Bedakan Terjadwal, Berlangsung,
  Ditutup, Draft, dan status pengisi Sudah dikirim.
- Hak akses ditegakkan di backend untuk semua jalur, termasuk endpoint lama.
- Jangan menjanjikan anonim atau mengubah skala, bobot, dan pertanyaan resmi
  tanpa keputusan produk yang eksplisit.

Implementasikan per slice kecil sesuai dependensi di todo.md. Reproduksi bug
interaksi/akses dengan tes yang relevan; jalankan tes terfokus setelah tiap slice.
Uji alur BPH, pengisi, dan divisi end-to-end; tambahkan kasus offline, dua perangkat,
nama kembar, batas jadwal, double-submit, dan kegagalan jaringan setelah commit.
Untuk UI, periksa screenshot atas/bawah pane pada 320, 390, 768, 1024, 1440 px,
keyboard, fokus, modal, loading/empty/error states. Jangan hanya mengandalkan build.

Output: flow sebelum/sesudah, perubahan konkret, file terdampak, hasil tes,
screenshot penting, keputusan yang masih terbuka, serta rencana migrasi/rollback.
Gunakan bahasa Indonesia yang jelas. Jangan klaim “100% aman” atau selesai jika
masih ada alur utama yang gagal. Prompt ini meminta implementasi lokal; push,
deploy, migrasi production, dan pengiriman undangan berada di luar prompt ini.
```
