# CMS user-flow review — 9 Oktober 2026

Scope: kode Worker, panel React, permission, data D1/R2, dependency yang terkunci,
dan browser lokal dengan fixture. Perubahan belum di-deploy. Layanan auth asli,
konfigurasi produksi, ACL bucket, dan rotasi kredensial tidak diuji lewat login produksi.

## Peta alur pengguna

| Area | Alur utama | Batas akses dan perilaku penting |
| --- | --- | --- |
| Login dan workspace | Login → `/me` → pilih CMS/division dashboard bila tersedia → halaman tujuan semula | Panel menyimpan marker non-secret; token di cookie HttpOnly. Handoff memakai kode sekali pakai. Sesi invalid kembali ke login; gangguan auth 503 mempertahankan sesi. |
| Roro | Chat/riwayat → proposal → konfirmasi → draft CMS → editor untuk publikasi | Riwayat per pengguna; hak membuat resource diperiksa saat konfirmasi. Oversight lintas pengguna hanya allowlist Ristek. Tes memakai provider fixture, bukan panggilan LLM berbayar. |
| Ringkasan | Angka event → kalender internal → event publik terdekat | Kalender internal dan daftar event publik berasal dari dua domain berbeda. Waktu tampil WIB. |
| Event publik | Daftar/cari/filter/kalender → buat draft → isi waktu, lokasi, sesi, cover → simpan → terbitkan/tarik/hapus | Admin divisi hanya mengubah miliknya; kontributor hanya draft; viewer baca. Draft tidak tersedia di endpoint publik. |
| Event Internal | Daftar divisi/kalender → detail → editor → terbitkan internal → bagikan link panel | Published dapat dibaca pengurus lintas divisi. Draft tetap dibatasi pemilik/admin. Media internal memerlukan auth; tidak ada endpoint publik untuk agenda internal. |
| Form | Buat → detail/pertanyaan → simpan/terbitkan/tutup → QR/link publik → respons/analitik/CSV/lampiran | Hak baca form berbeda dari hak membaca respons. Lampiran diunduh melalui endpoint admin yang memeriksa submission dan divisi. Hapus form menghapus seluruh respons juga. |
| QPR | BPH membuat kampanye → pertanyaan/target/roster → pratinjau → buka → pengisi pilih nama, autosave, review, submit → rekap/CSV | Snapshot dan roster terkunci setelah pertama dibuka. Draft memakai versi untuk konflik antarperangkat. Jalur publik memang tidak memverifikasi identitas pengisi; lihat batas keamanan di bawah. |
| Akun dan audit | Admin membuat membership/divisi → meninjau role/status → audit aktivitas | `accounts.manage` dan `audit.read` diperiksa terpisah. UI saat ini menyediakan pembuatan dan daftar; perubahan role/status tersedia lewat API. |

Role standar: `platform_admin` lintas divisi; `division_admin` divisi sendiri;
`contributor` membuat/mengedit draft event dan membaca konfigurasi form;
`viewer` membaca event. QPR management juga memerlukan workspace BPH.

## Temuan dan perbaikan

| ID | Dampak | Perbaikan | Bukti |
| --- | --- | --- | --- |
| F1 | Password tersimpan di dokumen tracked dan digunakan ulang sebagai fixture | Nilai dibersihkan dari dokumen, tabel, dan tes. Fixture menjadi `fixture-password`. | Pencarian nilai lama pada tree tracked; tidak melakukan login memakai password tersebut. Rotasi masih wajib. |
| F2 | Menyimpan form menghapus ID pertanyaan dan memutus analitik jawaban lama | ID lama divalidasi terhadap form pemilik, dipertahankan, dan dikirim panel. ID baru dari server dipakai setelah autosave. | Regresi simpan/urut ulang dengan jawaban historis gagal sebelum fix dan lolos sesudahnya. |
| F3 | Gagal menyimpan pertanyaan tetap mengubah judul/metadata form | Update metadata dan pertanyaan menjadi satu batch atomik | Trigger SQLite yang memaksa insert gagal membuktikan judul ikut rollback. |
| F4 | Lampiran publik tersimpan privat tetapi tidak bisa diunduh admin | Metadata file dalam daftar respons, tombol unduh, endpoint file yang memeriksa submission dan permission | Unduh owner 200; anonymous 401; lintas divisi, viewer, kontributor 403; file salah 404; response no-store dan attachment. |
| F5 | Jika bootstrap diaktifkan, akun suspended bisa kembali menjadi admin | Bootstrap hanya untuk identitas tanpa baris membership, dan BPH harus aktif | Fixture suspended sebelumnya menerima 200 untuk daftar akun; sesudah fix 403. Ini config-dependent, bukan bukti bypass produksi. |
| F6 | Logout error server dianggap sukses; Shell juga menghapus marker lebih dulu | Periksa status response, hanya reset setelah logout berhasil, tampilkan error yang bisa ditindaklanjuti | Browser 503 mempertahankan sesi dan menampilkan pesan gagal. |
| F7 | Tombol kembali di topbar membuang edit tanpa konfirmasi | Tombol navigasi keluar ikut guard perubahan belum disimpan | Browser membatalkan konfirmasi dan mempertahankan isi form. Guard tidak mencakup semua jenis navigasi history browser. |
| F8 | Form builder mobile didominasi kartu QR; sebagian input memakai gaya bawaan browser | QR/link menjadi bagian yang dapat dibuka; input tanpa type, search, number, tel mendapat gaya dasar yang sama | Screenshot sebelum/sesudah; konfigurasi form kini tampak pada layar pertama 390 px. |
| F9 | CSV menjalankan nilai seperti formula, kehilangan jawaban berlabel sama, dan tanggal tidak di-quote | Prefix teks untuk awalan formula, quote semua sel, kolom berdasarkan ID pertanyaan, tanggal eksplisit WIB | Browser mengunduh CSV dan memeriksa jawaban formula serta dua jawaban dengan label sama. |
| F10 | Daftar di atas 100 item melewati batas binding D1; panel berhenti pada halaman pertama | Query memakai satu parameter JSON dan `json_each`; panel membaca halaman berikutnya | Daftar 105 item gagal sebelum fix untuk ketiga modul, lolos sesudahnya; pencarian menemukan item halaman kedua. |
| F11 | Respons bulan lama dapat menimpa kalender yang sudah berpindah bulan | Hasil request yang sudah tidak aktif diabaikan | Skenario browser menunda respons bulan lama hingga bulan baru tampil. |
| F12 | Advisory dependency high pada sharp melalui Miniflare/Wrangler dan source-map-js | Miniflare 5.20261006.1-alpha, Wrangler 4.149.0, source-map-js 1.2.2 | Instalasi selesai; audit npm root dan panel masing-masing 0 vulnerability. Ini hasil database advisory saat pemeriksaan. |

CSV mitigation mengikuti [panduan OWASP](https://community.owasp.org/attacks/CSV_Injection).
Pengutipan CSV saja tidak mencegah formula. Perlakuan aplikasi spreadsheet berbeda;
menyimpan ulang file di aplikasi lain dapat mengubah escaping. Tes memeriksa bytes
hasil ekspor, bukan menjalankan seluruh aplikasi spreadsheet.

## Batas keamanan yang belum ditutup

1. **Rotasi password dan pencabutan sesi wajib dilakukan di layanan auth.** Menghapus
   teks dari working tree tidak menghapus salinan Git lama dan tidak menonaktifkan
   password. Status rotasi belum diverifikasi; jangan menyebut sistem 100% aman.
2. **QPR memakai model kejujuran yang disengaja.** Pemegang link publik dapat memilih
   nama orang lain, membaca/mengubah draft yang belum final, dan mengirim atas nama
   itu. Version check mencegah lost update, bukan pemalsuan identitas. Menutup ini
   memerlukan keputusan akses (login atau token pribadi per pengisi) dan perubahan
   alur distribusi, bukan sekadar perbaikan visual.
3. **Analitik yang sudah terputus sebelum perbaikan tidak otomatis dipulihkan.**
   Snapshot jawaban tetap ada. Menghubungkan ulang perlu data backup/identitas lama;
   menebak berdasarkan label dapat mencampur pertanyaan yang berbeda.
4. Integrasi internal Forms memakai shared secret handoff. Kebutuhan akses lintas
   form/divisi integrasi tersebut belum dikonfirmasi terhadap deployment eksternal.
5. File R2 orphan setelah penghapusan form/submission belum dipangkas otomatis;
   metadata dan jalur unduh hilang, objek tetap privat. Ini batas retensi/storage.
6. Audit ini tidak mencakup pentest produksi, seluruh riwayat Git, provider AI asli,
   browser Safari/Firefox nyata, atau kemampuan auth service mengganti password.

## Verifikasi

- `npm test`: exit 0; 853 baris assertion PASS/ok, termasuk `test:cms-flows`.
- Setelah suite lengkap, regresi tambahan urutan campuran pertanyaan lama/baru
  tanpa posisi eksplisit ditambahkan dan diperbaiki; suite Form terkait dan
  typecheck dijalankan ulang, keduanya exit 0.
- `npm run test:cms-flows`: histori Form, rollback, ownership file, bootstrap, dan batas D1.
- `npm run typecheck`, `npm --prefix panel run lint`, `npm --prefix panel run build`.
- `npm --prefix panel run test:ui`: 72 skenario lolos; alur panel desktop/mobile, hak akses, error,
  draft/publikasi, Form, QPR, Roro, keyboard, dan regresi tambahan di review ini.
- `npm --prefix panel run test:qpr-integration`: browser → Worker/D1/R2 lokal,
  admin membuat kampanye dan tamu melanjutkan lintas browser: 1 skenario lolos.

Lint: 0 error dan 28 warning React yang sudah ada sebelum review; warning bukan bukti
uji perilaku. Tidak ada perubahan pada data produksi, deployment, atau pesan ke
pengguna lain selama review ini.
