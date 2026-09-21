// Pertahanan Roro terhadap prompt-injection + permintaan di luar tugas (RORO-OVERSIGHT).
// Dipanggil SEBELUM LLM dipanggil untuk:
//   (1) menolak upaya injeksi prompt (hemat token, catat ke ai_events),
//   (2) menolak permintaan menulis/menjelaskan/mengerjakan kode program.
// Tujuan: Roro hanya boleh bantu event & form CMS — tidak boleh jadi alat
// coding, tidak boleh dipakai untuk task di luar nalar organisasi, dan tidak
// boleh kena injeksi instruksi dari konten/teks user yang mencoba override
// system prompt.
//
// Deteksi kasar tapi tegas: kumpulan sinyal (keyword + pola). False-positive
// lebih aman daripada false-negative di sini — pesan yang ditolak tetap
// diberi penjelasan ramah, dan Ristek bisa lihat upayanya di oversight.

export type PrecheckResult =
	| { blocked: false }
	| { blocked: true; reason: "injection" | "code"; refusal: string; signals: string[] };

// Sinyal injeksi prompt: instruksi yang mencoba override/abaikan system prompt,
// menyamar sebagai instruksi sistem, atau meminta peran/kemampuan baru.
const INJECTION_PATTERNS: Array<{ re: RegExp; signal: string }> = [
	{ re: /ignore\s+(all\s+)?(previous|prior|above|system)\s+(instructions?|prompts?|rules?)/i, signal: "ignore-previous" },
	{ re: /disregard\s+(all\s+)?(previous|prior|above|system)/i, signal: "disregard" },
	{ re: /forget\s+(your|all|the)\s+(instructions?|rules?|prompt|system)/i, signal: "forget-instructions" },
	{ re: /\b(system\s*prompt|prompt\s*sistem|instruksi\s*sistem|hidden\s*prompt)\b/i, signal: "system-prompt-ref" },
	{ re: /\b(you\s+are\s+(now|actually)|kamu\s+sekarang\s+adalah|sekarang\s+kamu\s+adalah)\b/i, signal: "role-hijack" },
	{ re: /\b(act\s+as|berperilaku\s+sebagai|bermain\s+sebagai)\s+(a\s+)?(developer|programmer|coder|hacker|admin|root|terminal|shell)/i, signal: "act-as-dev" },
	{ re: /\b(jailbreak|dAN[\s\S]{0,4}|break\s+out|lewat\s+sini|keluar\s+dari\s+aturan)\b/i, signal: "jailbreak" },
	{ re: /\b(reveal|show|tampilkan|tunjukkan|bocor)(kan)?\s+(your|kamu|the)?\s*(system\s*)?(prompt|instructions?|rules?|aturan)\b/i, signal: "reveal-prompt" },
	{ re: /\b(override|timpa|lewati|abaikan)\s+(aturan|rules|instructions|prompt|batasan|constraints)\b/i, signal: "override-rules" },
	{ re: /pretend\s+(you\s+(have|can|are)|that\s+there\s+are\s+no)/i, signal: "pretend-no-rules" },
	{ re: /\b(no\s+restrictions?|tanpa\s+batas|tanpa\s+aturan|unrestricted|no\s+rules)\b/i, signal: "no-restrictions" },
	{ re: /\b(exec(ute)?|run|jalankan|eval)\s+(arbitrary|code|perintah|command)\b/i, signal: "exec-code" },
	// Pola "prompt orangajin" klasik Indonesia: instruksi panjang menyamar sebagai
	// sistem yang menyuruh Roro melanggar aturan.
	{ re: /\[?\(?(SYSTEM|SISTEM|ADMIN|DEV)\]?\)?[\s:]/i, signal: "fake-system-prefix" },
	{ re: /sebagai\s+(sistem|admin|developer)\s+(kamu|harus|wajib|tolong|silakan)/i, signal: "fake-system-instr" },
];

// Sinyal permintaan kode/teknis di luar tugas Roro. Roro tidak boleh:
// menulis/menjelaskan/mengerjakan kode, skrip, query, atau task engineering.
const CODE_PATTERNS: Array<{ re: RegExp; signal: string }> = [
	{ re: /\b(tulis|buat|kerjakan|bikin|generate|berikan)\b[^\n]{0,40}\b(kode|code|program|skrip|script|function|fungsi|class|kelas|api|endpoint|component|komponen)\b/i, signal: "write-code" },
	{ re: /\b(code|kode)\s+(untuk|buat|untuk\s+membuat|generate)/i, signal: "code-for" },
	{ re: /\b(debug|perbaiki\s+(bug|error\s+kode|kodenya)|fix\s+the\s+(bug|code)|refactor)\b/i, signal: "debug-code" },
	{ re: /\b(sql|query|database\s+schema|migrate|migrasi|migration)\s+(query|untuk|buat|generate|write)/i, signal: "sql-query" },
	{ re: /\b(react|javascript|typescript|python|node\.?js|html|css|php|java|rust|go(?:lang)?)\b[^\n]{0,30}\b(kode|code|script|contoh|example|tutorial)/i, signal: "lang-code" },
	{ re: /\b(hack|exploit|vulnerability|celah\s+keamanan|reverse\s+engineer|decompile)\b/i, signal: "security-attack" },
	{ re: /\b(tuliskan\s+(saya\s+)?(?:sebuah|kode|code|program|fungsi|function))/i, signal: "write-code-id" },
	{ re: /\b(jelaskan\s+(bagaimana|cara)\s+(cara\s+)?(menulis|membuat|mengeksekusi|menjalankan)\s+(kode|code|program|sql|script))/i, signal: "explain-code" },
	{ re: /\b(explain\s+(how\s+to\s+write|the\s+code|this\s+(code|function)))\b/i, signal: "explain-code-en" },
	{ re: /```[a-z]*/, signal: "code-fence-request" }, // user minta balasan dalam blok kode
	{ re: /\b(kerjakan|selesaikan|bantu\s+task|bantu\s+kerjain)\s+(tugas|task|assignment|proyek|project)\b/i, signal: "do-assignment" },
];

// Catatan: deteksi "buat event" tidak boleh tertelan oleh CODE_PATTERNS —
// "buat" + "program" (acara) vs "program" (kode). Karena kita match "kode/code/
// program/skrip" bersamaan dengan "tulis/buat/kerjakan", kata "program"
// ambigu. Atasi: kalau konteks jelas event/form (ada "event"/"form"/"kegiatan"),
// anggap bukan kode. Dicek di cekCode aman-konteks.

const EVENT_CONTEXT = /\b(event|acara|kegiatan|formulir|form|pendaftaran|seminar|lomba|rapat|workshop|talk\s?show)\b/i;

export const precheckUserMessage = (raw: string): PrecheckResult => {
	const text = raw.slice(0, 8000);

	// (1) Injeksi prompt — cek dulu, paling berbahaya.
	const injSignals: string[] = [];
	for (const p of INJECTION_PATTERNS) {
		if (p.re.test(text)) injSignals.push(p.signal);
	}
	if (injSignals.length >= 1) {
		return {
			blocked: true,
			reason: "injection",
			signals: injSignals,
			refusal:
				"Tunggu dulu — pesanmu mengandung instruksi yang mencoba mengubah aturan atau peran saya. " +
				"Saya tetap Roro, asisten CMS untuk event dan form organisasi SGA. " +
				"Gimana kalau kita fokus ke event atau form yang mau kamu susun? Sebutkan judul, tanggal, dan lokasinya.",
		};
	}

	// (2) Permintaan kode/teknis — tolak, kecuali konteks jelas event/form.
	if (!EVENT_CONTEXT.test(text)) {
		const codeSignals: string[] = [];
		for (const p of CODE_PATTERNS) {
			if (p.re.test(text)) codeSignals.push(p.signal);
		}
		if (codeSignals.length >= 1) {
			return {
				blocked: true,
				reason: "code",
				signals: codeSignals,
				refusal:
					"Itu di luar kemampuan saya. Saya cuma bisa bantu menyusun event dan form di CMS SGA — " +
					"bukan menulis atau menjelaskan kode program. Kalau ada event/form yang mau dibuat, sebutkan detailnya ya.",
			};
		}
	}

	return { blocked: false };
};