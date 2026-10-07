import { QPR_DIVISIONS, QPR_ROLES, type QuestionnaireSnapshot, type QuestionnaireV3, type TargetConfig, type SnapshotQuestion, type SnapshotSection } from "./qpr.schema";

/**
 * Template kuesioner QPR Penilaian BPH — 7 section, masing-masing 20 skala
 * wajib + 2 teks wajib (sumber: form 9 bagian terbaru dari user; wording
 * kanonis dibaca dari workbook jawaban, sufiks duplikasi Google Forms
 * dibersihkan dari teks tampilan).
 *
 * Pemetaan kolom workbook (1-based, sheet "Form Responses 1"):
 *   Controller  skala 93-112, teks 113-114
 *   Bendum 1    skala 12-26 + 176-180, teks 28-29
 *   Bendum 2    skala 186-205, teks 206-207
 *   Sekum 1     skala 30-43 + 45 + 161-165, teks 48-49
 *   Sekum 2     skala 208-227, teks 228-229
 *   Ketum       skala 50-67 + 171-172, teks 68 + 173
 *   Waketum     skala 72-89 + 174-175, teks 90-91
 *
 * Waketum skala 17/18 (kolom 88/89) wording identik di sumber — DIKEWATI
 * sebagai dua ID berbeda sampai user putuskan. Jangan gabungkan.
 *
 * Nama orang TIDAK di-hardcode di sini: targetLabel diisi BPH saat setup
 * periode (mis. "Bendahara Umum 1" -> nama pengurus aktif).
 */

/** Skala 1-5 — legenda yang ditampilkan pengisi. */
export const SCALE_LEGEND: Record<number, string> = {
	1: "Sangat Kurang",
	2: "Kurang",
	3: "Cukup",
	4: "Baik",
	5: "Sangat Baik",
};

/** Target penilaian BPH. Urutan = urutan tampil di form. */
export const BPH_TARGETS = [
	{ id: "controller", label: "Controller" },
	{ id: "bendum1", label: "Bendahara Umum 1" },
	{ id: "bendum2", label: "Bendahara Umum 2" },
	{ id: "sekum1", label: "Sekretaris Umum 1" },
	{ id: "sekum2", label: "Sekretaris Umum 2" },
	{ id: "ketum", label: "Ketua Umum" },
	{ id: "waketum", label: "Wakil Ketua Umum" },
] as const;

export type BphTargetId = (typeof BPH_TARGETS)[number]["id"];

/** Section Controller — 20 skala + 2 teks dari workbook (kolom di atas). */
const CONTROLLER_QUESTIONS = [
	{ id: "controller-s01", type: "scale", label: "Controller melakukan monitoring progres divisi secara konsisten.", required: true },
	{ id: "controller-s02", type: "scale", label: "Controller mampu mengidentifikasi kendala dalam pelaksanaan program kerja.", required: true },
	{ id: "controller-s03", type: "scale", label: "Controller memberikan evaluasi yang jelas dan tepat waktu.", required: true },
	{ id: "controller-s04", type: "scale", label: "Controller aktif menindaklanjuti hasil evaluasi yang telah diberikan", required: true },
	{ id: "controller-s05", type: "scale", label: "Controller memastikan pelaksanaan kerja berjalan sesuai SOP organisasi.", required: true },
	{ id: "controller-s06", type: "scale", label: "Controller konsisten mengingatkan deadline dan target kerja.", required: true },
	{ id: "controller-s07", type: "scale", label: "Controller memantau pencapaian KPI setiap divisi secara objektif.", required: true },
	{ id: "controller-s08", type: "scale", label: "Controller menjalankan fungsi pengawasan secara tegas dan profesional.", required: true },
	{ id: "controller-s09", type: "scale", label: "Controller menyampaikan evaluasi dengan jelas dan mudah dipahami.", required: true },
	{ id: "controller-s10", type: "scale", label: "Controller responsif ketika dihubungi terkait evaluasi organisasi.", required: true },
	{ id: "controller-s11", type: "scale", label: "Controller mampu berkoordinasi dengan baik bersama BPH/divisi terkait.", required: true },
	{ id: "controller-s12", type: "scale", label: "Feedback yang diberikan membantu perbaikan kinerja.", required: true },
	{ id: "controller-s13", type: "scale", label: "Controller memberikan solusi konkret atas permasalahan organisasi.", required: true },
	{ id: "controller-s14", type: "scale", label: "Controller memberikan rekomendasi yang relevan untuk peningkatan kinerja.", required: true },
	{ id: "controller-s15", type: "scale", label: "Controller berkontribusi dalam pengembangan sistem evaluasi organisasi.", required: true },
	{ id: "controller-s16", type: "scale", label: "Masukan controller berdampak positif terhadap efektivitas organisasi.", required: true },
	{ id: "controller-s17", type: "scale", label: "Controller menjalankan tugas secara objektif dan adil.", required: true },
	{ id: "controller-s18", type: "scale", label: "Controller menunjukkan sikap profesional dalam setiap evaluasi.", required: true },
	{ id: "controller-s19", type: "scale", label: "Controller menjaga netralitas dalam proses penilaian.", required: true },
	{ id: "controller-s20", type: "scale", label: "Controller dapat dipercaya dalam menjalankan tanggung jawab pengawasan.", required: true },
	{ id: "controller-t01", type: "text", label: "Selama periode ini, apakah terdapat momen atau situasi tertentu (misalnya saat persiapan, pelaksanaan, maupun evaluasi program kerja) di mana Controller memberikan bantuan, masukan, monitoring, atau solusi yang berdampak bagi divisi Anda? Jelaskan situasi tersebut serta bagaimana kontribusi Controller membantu penyelesaiannya.", required: true },
	{ id: "controller-t02", type: "text", label: "Berdasarkan pengalaman Anda berinteraksi dengan Controller selama periode ini, apa yang sudah berjalan dengan baik dan apa yang masih perlu ditingkatkan agar peran Controller dapat lebih efektif dalam mendukung pelaksanaan program kerja dan perkembangan divisi?", required: true },
] as const;

/** Section Bendahara Umum 1 — 20 skala + 2 teks dari workbook (kolom di atas). */
const BENDUM_1_QUESTIONS = [
	{ id: "bendum1-s01", type: "scale", label: "Apakah laporan keuangan disusun dengan akurat dan dapat dipertanggungjawabkan?", required: true },
	{ id: "bendum1-s02", type: "scale", label: "Seberapa baik Bendahara dalam mengelola pemasukan dan pengeluaran organisasi?", required: true },
	{ id: "bendum1-s03", type: "scale", label: "Apakah ia mampu menjelaskan kondisi kas organisasi dengan transparan?", required: true },
	{ id: "bendum1-s04", type: "scale", label: "Apakah ia proaktif mengingatkan divisi soal pelaporan dan anggaran?", required: true },
	{ id: "bendum1-s05", type: "scale", label: "Apakah ia mengusulkan sistem pengelolaan keuangan yang lebih efisien?", required: true },
	{ id: "bendum1-s06", type: "scale", label: "Seberapa inisiatif ia dalam menjaga kestabilan keuangan organisasi?", required: true },
	{ id: "bendum1-s07", type: "scale", label: "Seberapa komunikatif Bendahara dengan divisi lain dalam urusan pendanaan?", required: true },
	{ id: "bendum1-s08", type: "scale", label: "Apakah ia mampu memberikan penjelasan keuangan dengan mudah dipahami?", required: true },
	{ id: "bendum1-s09", type: "scale", label: "Seberapa terbuka ia dalam berdiskusi tentang pengeluaran atau permintaan dana?", required: true },
	{ id: "bendum1-s10", type: "scale", label: "Apakah Bendahara hadir aktif dalam kegiatan dan rapat penting?", required: true },
	{ id: "bendum1-s11", type: "scale", label: "Seberapa sering ia terlibat dalam pencatatan dana selama kegiatan?", required: true },
	{ id: "bendum1-s12", type: "scale", label: "Seberapa besar keterlibatannya dalam mendukung program kerja dari aspek keuangan?", required: true },
	{ id: "bendum1-s13", type: "scale", label: "Apakah ia tepat waktu dalam menyusun dan menyampaikan laporan keuangan?", required: true },
	{ id: "bendum1-s14", type: "scale", label: "Seberapa cepat dan transparan proses pencairan dana dan reimbursement yang dikelola oleh Bendahara Umum untuk kebutuhan proker divisi Kamu?", required: true },
	{ id: "bendum1-s15", type: "scale", label: "Apakah pengarsipan keuangannya konsisten dan on-time?", required: true },
	{ id: "bendum1-s16", type: "scale", label: "Bendahara Umum efektif dalam memberikan arahan, mengawasi kinerja, dan membantu menyelesaikan kendala yang dihadapi oleh para bendahara divisi", required: true },
	{ id: "bendum1-s17", type: "scale", label: "Bendahara Umum tegas dalam menegakkan aturan batasan anggaran dan menolak pengajuan dana divisi yang tidak sesuai dengan SOP atau RAB yang telah disepakati", required: true },
	{ id: "bendum1-s18", type: "scale", label: "Seberapa tanggap dan solutif Bendahara Umum dalam saran saat divisi Anda mengalami kendala finansial (Misal: Membutuhkan anggaran yang sangat besar; terdapat biaya tambahan di luar dugaan ketika menjalankan proker)", required: true },
	{ id: "bendum1-s19", type: "scale", label: "Bendahara Umum objektif dalam menilai urgensi serta menetapkan besaran alokasi anggaran untuk setiap divisi/program kerja", required: true },
	{ id: "bendum1-s20", type: "scale", label: "Bendahara Umum teliti dalam validitas bukti transaksi (nota/kuitansi) yang diserahkan oleh panitia proker sebelum dimasukkan ke dalam laporan akhir", required: true },
	{ id: "bendum1-t01", type: "text", label: "Pernahkah divisi Kamu mengalami kendala finansial dalam menjalankan proker yang disebabkan oleh alur kerja Bendahara Umum serta ada tindakan dari Bendahara Umum yang memberatkan divisi Anda? Jika ada, Ceritakan secara singkat!", required: true },
	{ id: "bendum1-t02", type: "text", label: "Menurut Kamu, apa yang bisa ditingkatkan oleh Bendahara Umum dalam hal komunikasi, prosedur, atau kebijakan keuangan agar dapat lebih mendukung kelancaran eksekusi proker semua divisi?", required: true },
] as const;

/** Section Bendahara Umum 2 — 20 skala + 2 teks dari workbook (kolom di atas). */
const BENDUM_2_QUESTIONS = [
	{ id: "bendum2-s01", type: "scale", label: "Apakah laporan keuangan disusun dengan akurat dan dapat dipertanggungjawabkan?", required: true },
	{ id: "bendum2-s02", type: "scale", label: "Seberapa baik Bendahara dalam mengelola pemasukan dan pengeluaran organisasi?", required: true },
	{ id: "bendum2-s03", type: "scale", label: "Apakah ia mampu menjelaskan kondisi kas organisasi dengan transparan?", required: true },
	{ id: "bendum2-s04", type: "scale", label: "Apakah ia proaktif mengingatkan divisi soal pelaporan dan anggaran?", required: true },
	{ id: "bendum2-s05", type: "scale", label: "Apakah ia mengusulkan sistem pengelolaan keuangan yang lebih efisien?", required: true },
	{ id: "bendum2-s06", type: "scale", label: "Seberapa inisiatif ia dalam menjaga kestabilan keuangan organisasi?", required: true },
	{ id: "bendum2-s07", type: "scale", label: "Seberapa komunikatif Bendahara dengan divisi lain dalam urusan pendanaan?", required: true },
	{ id: "bendum2-s08", type: "scale", label: "Apakah ia mampu memberikan penjelasan keuangan dengan mudah dipahami?", required: true },
	{ id: "bendum2-s09", type: "scale", label: "Seberapa terbuka ia dalam berdiskusi tentang pengeluaran atau permintaan dana?", required: true },
	{ id: "bendum2-s10", type: "scale", label: "Apakah Bendahara hadir aktif dalam kegiatan dan rapat penting?", required: true },
	{ id: "bendum2-s11", type: "scale", label: "Seberapa sering ia terlibat dalam pencatatan dana selama kegiatan?", required: true },
	{ id: "bendum2-s12", type: "scale", label: "Seberapa besar keterlibatannya dalam mendukung program kerja dari aspek keuangan?", required: true },
	{ id: "bendum2-s13", type: "scale", label: "Apakah ia tepat waktu dalam menyusun dan menyampaikan laporan keuangan?", required: true },
	{ id: "bendum2-s14", type: "scale", label: "Seberapa cepat dan transparan proses pencairan dana dan reimbursement yang dikelola oleh Bendahara Umum untuk kebutuhan proker divisi Kamu?", required: true },
	{ id: "bendum2-s15", type: "scale", label: "Apakah pengarsipan keuangannya konsisten dan on-time?", required: true },
	{ id: "bendum2-s16", type: "scale", label: "Bendahara Umum efektif dalam memberikan arahan, mengawasi kinerja, dan membantu menyelesaikan kendala yang dihadapi oleh para bendahara divisi", required: true },
	{ id: "bendum2-s17", type: "scale", label: "Bendahara Umum tegas dalam menegakkan aturan batasan anggaran dan menolak pengajuan dana divisi yang tidak sesuai dengan SOP atau RAB yang telah disepakati", required: true },
	{ id: "bendum2-s18", type: "scale", label: "Seberapa tanggap dan solutif Bendahara Umum dalam saran saat divisi Anda mengalami kendala finansial (Misal: Membutuhkan anggaran yang sangat besar; terdapat biaya tambahan di luar dugaan ketika menjalankan proker)", required: true },
	{ id: "bendum2-s19", type: "scale", label: "Bendahara Umum objektif dalam menilai urgensi serta menetapkan besaran alokasi anggaran untuk setiap divisi/program kerja", required: true },
	{ id: "bendum2-s20", type: "scale", label: "Bendahara Umum teliti dalam validitas bukti transaksi (nota/kuitansi) yang diserahkan oleh panitia proker sebelum dimasukkan ke dalam laporan akhir", required: true },
	{ id: "bendum2-t01", type: "text", label: "Pernahkah divisi Kamu mengalami kendala finansial dalam menjalankan proker yang disebabkan oleh alur kerja Bendahara Umum serta ada tindakan dari Bendahara Umum yang memberatkan divisi Anda? Jika ada, Ceritakan secara singkat!", required: true },
	{ id: "bendum2-t02", type: "text", label: "Menurut Kamu, apa yang bisa ditingkatkan oleh Bendahara Umum dalam hal komunikasi, prosedur, atau kebijakan keuangan agar dapat lebih mendukung kelancaran eksekusi proker semua divisi?", required: true },
] as const;

/** Section Sekretaris Umum 1 — 20 skala + 2 teks dari workbook (kolom di atas). */
const SEKUM_1_QUESTIONS = [
	{ id: "sekum1-s01", type: "scale", label: "Apakah Sekretaris mampu menyusun dan mendistribusikan dokumen administratif dengan baik?", required: true },
	{ id: "sekum1-s02", type: "scale", label: "Seberapa rapi dan teratur pengelolaan arsip, notulen, dan surat menyurat?", required: true },
	{ id: "sekum1-s03", type: "scale", label: "Seberapa besar peran Sekretaris dalam mendukung kelancaran kegiatan?", required: true },
	{ id: "sekum1-s04", type: "scale", label: "Apakah Sekretaris aktif menawarkan bantuan administratif ke divisi lain?", required: true },
	{ id: "sekum1-s05", type: "scale", label: "Apakah ia mengambil inisiatif dalam menjaga timeline laporan administrasi?", required: true },
	{ id: "sekum1-s06", type: "scale", label: "Apakah ia mencari cara efisien untuk meningkatkan sistem dokumentasi?", required: true },
	{ id: "sekum1-s07", type: "scale", label: "Seberapa baik koordinasi Sekretaris dengan BPH dan divisi terkait?", required: true },
	{ id: "sekum1-s08", type: "scale", label: "Apakah ia mudah dihubungi dan responsif terhadap permintaan dokumen?", required: true },
	{ id: "sekum1-s09", type: "scale", label: "Seberapa jelas dan sistematis komunikasinya dalam membuat laporan atau notulen?", required: true },
	{ id: "sekum1-s10", type: "scale", label: "Seberapa konsisten kehadiran Sekretaris dalam rapat/kegiatan?", required: true },
	{ id: "sekum1-s11", type: "scale", label: "Apakah ia aktif mencatat, mengarsipkan, dan melaporkan secara real-time?", required: true },
	{ id: "sekum1-s12", type: "scale", label: "Apakah ia turut membantu alur kegiatan saat berlangsung?", required: true },
	{ id: "sekum1-s13", type: "scale", label: "Seberapa tepat waktu ia dalam mengumpulkan/membagikan notulen/agenda?", required: true },
	{ id: "sekum1-s14", type: "scale", label: "Apakah ia mengelola deadline administratif dengan baik?", required: true },
	{ id: "sekum1-s15", type: "scale", label: "Seberapa mudah divisi Kalian mengakses dokumen atau arsip penting dari proker sebelumnya yang dikelola oleh Sekretaris Umum?", required: true },
	{ id: "sekum1-s16", type: "scale", label: "Sekretaris Umum mencarikan alternatif/jalan keluar ketika terjadi kendala birokrasi dari pihak kampus (misalnya: bentrok jadwal ruang kelas)", required: true },
	{ id: "sekum1-s17", type: "scale", label: "Sekretaris Umum menyampaikan syarat, regulasi, maupun perubahan kebijakan terbaru dari pihak kampus", required: true },
	{ id: "sekum1-s18", type: "scale", label: "Sekretaris Umum mengoreksi dan memastikan kelengkapan berkas proker sebelum diajukan ke pihak yang ingin dituju agar meminimalkan risiko penolakan", required: true },
	{ id: "sekum1-s19", type: "scale", label: "Sekretaris Umum menyampaikan surat-menyurat dan perizinan ke pihak eksternal/kampus secara tepat waktu sehingga tidak mengganggu timeline eksekusi proker", required: true },
	{ id: "sekum1-s20", type: "scale", label: "Sekretaris Umum membuat standarisasi format dokumen (SOP surat, proposal, LPJ) yang jelas demi kemudahan organisasi ke depan", required: true },
	{ id: "sekum1-t01", type: "text", label: "Dalam pelaksanaan proker Divisi Kalian, adakah alur administrasi dari Sekretaris Umum yang terasa lambat atau menghambat? Jika ada, Jelaskan di bagian mana!", required: true },
	{ id: "sekum1-t02", type: "text", label: "Usulan seperti apa yang Kamu miliki untuk Sekretaris Umum agar sistem administrasi dan dokumentasi SGA bisa lebih efisien dalam mendukung kelancaran semua proker divisi?", required: true },
] as const;

/** Section Sekretaris Umum 2 — 20 skala + 2 teks dari workbook (kolom di atas). */
const SEKUM_2_QUESTIONS = [
	{ id: "sekum2-s01", type: "scale", label: "Apakah Sekretaris mampu menyusun dan mendistribusikan dokumen administratif dengan baik?", required: true },
	{ id: "sekum2-s02", type: "scale", label: "Seberapa rapi dan teratur pengelolaan arsip, notulen, dan surat menyurat?", required: true },
	{ id: "sekum2-s03", type: "scale", label: "Seberapa besar peran Sekretaris dalam mendukung kelancaran kegiatan?", required: true },
	{ id: "sekum2-s04", type: "scale", label: "Apakah Sekretaris aktif menawarkan bantuan administratif ke divisi lain?", required: true },
	{ id: "sekum2-s05", type: "scale", label: "Apakah ia mengambil inisiatif dalam menjaga timeline laporan administrasi?", required: true },
	{ id: "sekum2-s06", type: "scale", label: "Apakah ia mencari cara efisien untuk meningkatkan sistem dokumentasi?", required: true },
	{ id: "sekum2-s07", type: "scale", label: "Seberapa baik koordinasi Sekretaris dengan BPH dan divisi terkait?", required: true },
	{ id: "sekum2-s08", type: "scale", label: "Apakah ia mudah dihubungi dan responsif terhadap permintaan dokumen?", required: true },
	{ id: "sekum2-s09", type: "scale", label: "Seberapa jelas dan sistematis komunikasinya dalam membuat laporan atau notulen?", required: true },
	{ id: "sekum2-s10", type: "scale", label: "Seberapa konsisten kehadiran Sekretaris dalam rapat/kegiatan?", required: true },
	{ id: "sekum2-s11", type: "scale", label: "Apakah ia aktif mencatat, mengarsipkan, dan melaporkan secara real-time?", required: true },
	{ id: "sekum2-s12", type: "scale", label: "Apakah ia turut membantu alur kegiatan saat berlangsung?", required: true },
	{ id: "sekum2-s13", type: "scale", label: "Seberapa tepat waktu ia dalam mengumpulkan/membagikan notulen/agenda?", required: true },
	{ id: "sekum2-s14", type: "scale", label: "Apakah ia mengelola deadline administratif dengan baik?", required: true },
	{ id: "sekum2-s15", type: "scale", label: "Seberapa mudah divisi Kalian mengakses dokumen atau arsip penting dari proker sebelumnya yang dikelola oleh Sekretaris Umum?", required: true },
	{ id: "sekum2-s16", type: "scale", label: "Sekretaris Umum mencarikan alternatif/jalan keluar ketika terjadi kendala birokrasi dari pihak kampus (misalnya: bentrok jadwal ruang kelas)", required: true },
	{ id: "sekum2-s17", type: "scale", label: "Sekretaris Umum menyampaikan syarat, regulasi, maupun perubahan kebijakan terbaru dari pihak kampus", required: true },
	{ id: "sekum2-s18", type: "scale", label: "Sekretaris Umum mengoreksi dan memastikan kelengkapan berkas proker sebelum diajukan ke pihak yang ingin dituju agar meminimalkan risiko penolakan", required: true },
	{ id: "sekum2-s19", type: "scale", label: "Sekretaris Umum menyampaikan surat-menyurat dan perizinan ke pihak eksternal/kampus secara tepat waktu sehingga tidak mengganggu timeline eksekusi proker", required: true },
	{ id: "sekum2-s20", type: "scale", label: "Sekretaris Umum membuat standarisasi format dokumen (SOP surat, proposal, LPJ) yang jelas demi kemudahan organisasi ke depan", required: true },
	{ id: "sekum2-t01", type: "text", label: "Dalam pelaksanaan proker Divisi Kalian, adakah alur administrasi dari Sekretaris Umum yang terasa lambat atau menghambat? Jika ada, Jelaskan di bagian mana!", required: true },
	{ id: "sekum2-t02", type: "text", label: "Usulan seperti apa yang Kamu miliki untuk Sekretaris Umum agar sistem administrasi dan dokumentasi SGA bisa lebih efisien dalam mendukung kelancaran semua proker divisi?", required: true },
] as const;

/** Section Ketua Umum — 20 skala + 2 teks dari workbook (kolom di atas). */
const KETUM_QUESTIONS = [
	{ id: "ketum-s01", type: "scale", label: "Apakah Ketua mampu mengarahkan SGA untuk mencapai tujuan organisasi?", required: true },
	{ id: "ketum-s02", type: "scale", label: "Seberapa baik Ketua dalam memastikan program kerja berjalan sesuai timeline?", required: true },
	{ id: "ketum-s03", type: "scale", label: "Sejauh mana Ketua memenuhi ekspektasi sebagai pemimpin utama organisasi?", required: true },
	{ id: "ketum-s04", type: "scale", label: "Seberapa aktif Ketua dalam merespons permasalahan internal/eksternal?", required: true },
	{ id: "ketum-s05", type: "scale", label: "Apakah Ketua menunjukkan kepemimpinan proaktif dalam mendorong inovasi?", required: true },
	{ id: "ketum-s06", type: "scale", label: "Apakah ia mampu mengambil keputusan penting dengan sigap?", required: true },
	{ id: "ketum-s07", type: "scale", label: "Seberapa baik kemampuan Ketua dalam membangun komunikasi lintas divisi?", required: true },
	{ id: "ketum-s08", type: "scale", label: "Apakah ia mendengarkan masukan anggota sebelum mengambil keputusan?", required: true },
	{ id: "ketum-s09", type: "scale", label: "Seberapa terbuka Ketua terhadap kritik dan saran?", required: true },
	{ id: "ketum-s10", type: "scale", label: "Apakah Ketua hadir dan terlibat aktif dalam kegiatan organisasi?", required: true },
	{ id: "ketum-s11", type: "scale", label: "Seberapa besar perannya dalam menyemangati anggota saat rapat atau kegiatan?", required: true },
	{ id: "ketum-s12", type: "scale", label: "Seberapa konsisten ia mengawal kegiatan BPH dan divisi-divisi?", required: true },
	{ id: "ketum-s13", type: "scale", label: "Apakah Ketua tepat waktu saat rapat maupun kegiatan eksternal?", required: true },
	{ id: "ketum-s14", type: "scale", label: "Seberapa tepat waktu ia dalam memberikan arahan dan keputusan penting?", required: true },
	{ id: "ketum-s15", type: "scale", label: "Apakah Ketua menunjukkan disiplin waktu sebagai role model?", required: true },
	{ id: "ketum-s16", type: "scale", label: "Seberapa besar dukungan yang Kamu rasakan dari Ketua ketika divisi Kamu menghadapi hambatan dalam menjalankan proker (misal: birokrasi, masalah perizinan, atau konflik internal)?", required: true },
	{ id: "ketum-s17", type: "scale", label: "Seberapa baik Ketua dalam mengkomunikasikan segala sesuatu sehingga proker divisi Kamu (contoh: Chill Spill, Ruang Temu, Workshop, dll.) terasa sejalan dan didukung?", required: true },
	{ id: "ketum-s18", type: "scale", label: "Seberapa proaktif Ketua dalam memantau, memberikan masukan, atau terlibat dalam proker-proker kunci divisi Anda tanpa harus selalu diminta?", required: true },
	{ id: "ketum-s19", type: "scale", label: "Seberapa baik Ketua dalam memberikan ruang bagi anggota untuk berkembang, menyampaikan ide, dan berkontribusi dalam organisasi?", required: true },
	{ id: "ketum-s20", type: "scale", label: "Seberapa aktif Ketua dalam melakukan evaluasi terhadap program kerja dan kinerja organisasi untuk mendorong perbaikan ke depannya?", required: true },
	{ id: "ketum-t01", type: "text", label: "Menurut Anda, apa kelebihan dan hal yang masih perlu ditingkatkan dari Ketua Umum dalam memimpin organisasi? Sertakan contoh pengalaman, arahan, keputusan, atau dukungan yang pernah Anda rasakan secara langsung.", required: true },
	{ id: "ketum-t02", type: "text", label: "Apa saran atau langkah yang dapat dilakukan Ketua Umum untuk meningkatkan kualitas kepemimpinan, dukungan terhadap divisi, serta dampak organisasi ke depannya? Jelaskan alasannya.", required: true },
] as const;

/** Section Wakil Ketua Umum — 20 skala + 2 teks dari workbook (kolom di atas). */
const WAKETUM_QUESTIONS = [
	{ id: "waketum-s01", type: "scale", label: "Sejauh mana Wakil Ketua mendukung tugas Ketua dan keberjalanan organisasi?", required: true },
	{ id: "waketum-s02", type: "scale", label: "Apakah Wakil Ketua berhasil mengoordinasikan kerja antar divisi?", required: true },
	{ id: "waketum-s03", type: "scale", label: "Seberapa besar kontribusinya dalam menjaga stabilitas internal SGA?", required: true },
	{ id: "waketum-s04", type: "scale", label: "Apakah Wakil Ketua sigap mengambil alih ketika Ketua berhalangan?", required: true },
	{ id: "waketum-s05", type: "scale", label: "Seberapa aktif ia dalam membantu divisi-divisi menjalankan program?", required: true },
	{ id: "waketum-s06", type: "scale", label: "Apakah ia mengusulkan langkah-langkah konkret dalam perbaikan organisasi?", required: true },
	{ id: "waketum-s07", type: "scale", label: "Apakah Wakil Ketua dapat membangun relasi positif dengan seluruh pengurus?", required: true },
	{ id: "waketum-s08", type: "scale", label: "Seberapa baik ia dalam memediasi konflik atau potensi konflik?", required: true },
	{ id: "waketum-s09", type: "scale", label: "Apakah ia menyampaikan aspirasi divisi ke Ketua dengan baik?", required: true },
	{ id: "waketum-s10", type: "scale", label: "Apakah Wakil hadir aktif dalam rapat dan program?", required: true },
	{ id: "waketum-s11", type: "scale", label: "Apakah kehadirannya memberikan dampak positif dalam tim?", required: true },
	{ id: "waketum-s12", type: "scale", label: "Seberapa sering ia membantu divisi-divisi tanpa diminta?", required: true },
	{ id: "waketum-s13", type: "scale", label: "Apakah Wakil Ketua menjalankan tugasnya dengan tepat waktu?", required: true },
	{ id: "waketum-s14", type: "scale", label: "Seberapa disiplin ia dalam agenda organisasi?", required: true },
	{ id: "waketum-s15", type: "scale", label: "Seberapa responsif ia terhadap kebutuhan mendesak divisi?", required: true },
	{ id: "waketum-s16", type: "scale", label: "Seberapa baik Wakil Ketua dalam mengkomunikasikan segala sesuatu sehingga proker divisi Kamu terasa sejalan dan didukung?", required: true },
	{ id: "waketum-s17", type: "scale", label: "Seberapa besar dukungan yang Kamu rasakan dari Wakil Ketua ketika divisi Kamu menghadapi hambatan dalam menjalankan proker (misal: birokrasi, masalah perizinan, atau konflik internal)?", required: true },
	{ id: "waketum-s18", type: "scale", label: "Seberapa besar dukungan yang Kamu rasakan dari Wakil Ketua ketika divisi Kamu menghadapi hambatan dalam menjalankan proker (misal: birokrasi, masalah perizinan, atau konflik internal)?", required: true },
	{ id: "waketum-s19", type: "scale", label: "Seberapa aktif Wakil Ketua memantau perkembangan program kerja dan menindaklanjuti kendala yang dihadapi divisi-divisi?", required: true },
	{ id: "waketum-s20", type: "scale", label: "Seberapa baik Wakil Ketua mendorong pengurus untuk berkembang, berkontribusi, dan menjalankan perannya secara optimal?", required: true },
	{ id: "waketum-t01", type: "text", label: "Menurut Anda, apa kelemahan atau hal yang masih perlu ditingkatkan dari Wakil Ketua Umum dalam menjalankan perannya mendampingi Ketua, mengoordinasikan organisasi, dan mendukung divisi-divisi? Sertakan contoh jika ada.", required: true },
	{ id: "waketum-t02", type: "text", label: "Apa saran atau ide yang dapat dilakukan Wakil Ketua Umum untuk meningkatkan kualitas koordinasi, dukungan terhadap divisi, dan perkembangan SGA ke depannya? Jelaskan alasannya.", required: true },
] as const;

/** Snapshot v2 lengkap — dipakai createPeriod (form_kind bph). */
export function buildBphSections(targetLabels: Partial<Record<BphTargetId, string>> = {}): SnapshotSection[] {
	return BPH_TARGETS.map(({ id, label }) => ({
		id: `section-${id}`,
		title: targetLabels[id] ? `${label}: ${targetLabels[id]}` : label,
		targetId: id,
		targetLabel: targetLabels[id] ?? label,
		questions: [...QUESTIONS_BY_TARGET[id]],
	}));
}

const QUESTIONS_BY_TARGET: Record<BphTargetId, readonly SnapshotQuestion[]> = {
	controller: CONTROLLER_QUESTIONS,
	bendum1: BENDUM_1_QUESTIONS,
	bendum2: BENDUM_2_QUESTIONS,
	sekum1: SEKUM_1_QUESTIONS,
	sekum2: SEKUM_2_QUESTIONS,
	ketum: KETUM_QUESTIONS,
	waketum: WAKETUM_QUESTIONS,
};

/**
 * Validasi template BPH: 7 section, 20 skala + 2 teks per section, semua ID
 * unik, wording tidak kosong. Dipanggil createPeriod form bph — template
 * rusak = blocker, bukan jalur kosong.
 */
export function validateBphTemplate(sections: SnapshotSection[]): string[] {
	const errors: string[] = [];
	const ids = new Set<string>();
	if (sections.length !== BPH_TARGETS.length) errors.push(`Section harus ${BPH_TARGETS.length}, dapat ${sections.length}`);
	for (const s of sections) {
		const scale = s.questions.filter((q) => q.type === "scale");
		const text = s.questions.filter((q) => q.type === "text");
		if (scale.length !== 20) errors.push(`${s.title}: skala harus 20, dapat ${scale.length}`);
		if (text.length !== 2) errors.push(`${s.title}: teks harus 2, dapat ${text.length}`);
		for (const q of s.questions) {
			if (ids.has(q.id)) errors.push(`ID pertanyaan ganda: ${q.id}`);
			ids.add(q.id);
			if (!q.label.trim()) errors.push(`${q.id}: label kosong`);
			if (!q.required) errors.push(`${q.id}: harus wajib`);
			const position = s.questions.indexOf(q);
			if (q.type !== (position < 20 ? "scale" : "text")) errors.push(`${q.id}: urutan skala/teks salah`);
		}
	}
    const deputy = sections.find((s) => s.targetId === "waketum");
    if (!deputy || deputy.questions[16]?.label !== deputy.questions[17]?.label || deputy.questions[16]?.id === deputy.questions[17]?.id) errors.push("Waketum 17/18 harus dua ID dengan wording identik");
	return errors;
}

/**
 * Jalur responden: section mana yang wajib diisi role ini. Sumber tunggal
 * untuk preview, pengisian, progress, validasi submit, dan rekap — frontend
 * tidak punya logika percabangan kedua.
 *
 * ctx.controllers/bendahara/sekretaris: target ID yang ditugaskan untuk
 * divisi responden (dari konfigurasi periode, bukan hardcode). Contoh:
 * divisi Research & Technology -> controllers: ["controller"].
 */
export type BphRole =
	| "ketum" | "waketum" | "sekum" | "bendum" | "controller" // BPH
	| "kadiv" | "wakadiv" | "bendiv" | "sekdiv" | "anggota"; // divisi

export function resolveBphPath(
	role: BphRole,
	ctx: { controllers: BphTargetId[]; bendahara: BphTargetId[]; sekretaris: BphTargetId[] },
): BphTargetId[] {
	// BPH inti menilai Ketum + Waketum (eligibility self-review dikonfirmasi
	// BPH saat setup — di sini anggap eligible sampai dikatakan lain).
	const leaders: BphTargetId[] = ["ketum", "waketum"];
	switch (role) {
		case "kadiv":
		case "wakadiv":
			return [...ctx.controllers, ...leaders];
		case "bendiv":
			return [...ctx.bendahara, ...leaders];
		case "sekdiv":
			return [...ctx.sekretaris, ...leaders];
		default:
			// anggota, controller, sekum, bendum, ketum, waketum: hanya leaders.
			return leaders;
	}
}

export const defaultTargetConfig = (): TargetConfig => ({
 targets: [...[1, 2, 3, 4].map((n) => ({ id: `controller${n}`, label: "", template: "controller" as const })),
  ...BPH_TARGETS.filter((t) => t.id !== "controller").map((t) => ({ id: t.id, label: "", template: t.id }))],
 controller_by_division: {},
});

export function validateTargetConfig(config: TargetConfig): string[] {
 const errors: string[] = [];
 const ids = new Set<string>();
 for (const t of config.targets) {
  if (ids.has(t.id)) errors.push(`Target ID berulang: ${t.id}`);
  ids.add(t.id);
  if (t.template !== "controller" && t.id !== t.template) errors.push(`ID target harus ${t.template}`);
  if (t.template === "controller" && BPH_TARGETS.some((b) => b.id === t.id)) errors.push(`ID Controller tidak boleh ${t.id}`);
 }
 for (const [slug, id] of Object.entries(config.controller_by_division)) {
  if (!(QPR_DIVISIONS as readonly string[]).includes(slug)) errors.push(`Divisi tidak dikenal: ${slug}`);
  if (id && !config.targets.some((t) => t.id === id && t.template === "controller")) errors.push(`Controller tidak dikenal: ${id}`);
 }
 return errors;
}

export function buildBphSnapshot(config: TargetConfig = defaultTargetConfig()): QuestionnaireV3 {
 // Keputusan BPH (7 Okt 2026): Controller = BPH, DINILAI semua kadiv/wakadiv
 // (bukan pemetaan 1 controller per divisi). Kadiv/wakadiv menilai 4 controller
 // + ketum + waketum. bendiv → 2 bendum, sekdiv → 2 sekum.
 const CONTROLLER_IDS = config.targets.filter((t) => t.template === "controller").map((t) => t.id);
 return {
  version: 3, target_config: config,
  routing: Object.fromEntries(QPR_ROLES.map((role) => [role,
   [...(role === "kadiv" || role === "wakadiv" ? CONTROLLER_IDS : role === "bendiv" ? ["bendum1", "bendum2"] : role === "sekdiv" ? ["sekum1", "sekum2"] : []), "ketum", "waketum"]])),
  sections: config.targets.map((t) => ({
   id: `section-${t.id}`, targetId: t.id, targetLabel: t.label,
   title: `${BPH_TARGETS.find((b) => b.id === t.template)!.label}${t.label ? `: ${t.label}` : ""}`,
   questions: QUESTIONS_BY_TARGET[t.template].map((q) => ({ ...q, id: q.id.replace(`${t.template}-`, `${t.id}-`) })),
  })),
 };
}

/** v2 keeps its original one-bendum/one-sekum path, including legacy role fallback. */
export function resolveSnapshotPath(snapshot: QuestionnaireSnapshot, entry: { memberRole: string | null; divisionSlug: string | null }): SnapshotSection[] {
 let targets: string[];
 if (snapshot.version === 2) {
  targets = resolveBphPath((entry.memberRole ?? "anggota") as BphRole, { controllers: ["controller"], bendahara: ["bendum1"], sekretaris: ["sekum1"] });
 } else {
  const route = snapshot.routing[entry.memberRole ?? ""];
  if (!route || !(QPR_ROLES as readonly string[]).includes(entry.memberRole ?? "")) throw new Error("Jabatan pengisi tidak dikenal");
  if (!(QPR_DIVISIONS as readonly string[]).includes(entry.divisionSlug ?? "")) throw new Error("Divisi perlu pemetaan BPH");
  targets = route.map((id) => id === "$controller" ? snapshot.target_config.controller_by_division[entry.divisionSlug!] : id);
 }
 return targets.map((id) => {
  const section = snapshot.sections.find((s) => s.targetId === id);
  if (!section) throw new Error(`Target belum dikonfigurasi: ${id ?? "Controller divisi"}`);
  return section;
 });
}
