// Guard engine Roro (RORO-GUARD-ENGINE): pertahanan terhadap prompt-injection
// + permintaan di luar tugas, TANPA hardcode pola di kode. Aturan hidup di
// tabel ai_guard_rules (drizzle/0012_roro_guard_rules.sql) — Ristek tambah/ubah/
// matikan pola lewat DB tanpa deploy.
//
// Format pattern:
//   diawali "re:"  → regex satu baris, flag "i", dipisah "||" untuk beberapa
//   selain itu     → substring case-insensitive
// Contoh: "re:\bjailbreak\b||\bDAN\s+mode\b", "kasih link download film"
//
// Kosong/tabel belum ada → engine tetap jalan pakai FALLBACK_RULES di bawah
// (subset pola inti). Cache in-memory 60 dtk per isolate.
//
// Konteks aman: kalau pesan jelas soal event/form (EVENT_CONTEXT), aturan
// kategori "code" dilewati — "buat form polling" bukan permintaan kode.

import { eq } from "drizzle-orm";
import { aiGuardRules } from "../../db/schema";
import type { Db } from "../../db/connection";

export type PrecheckResult =
	| { blocked: false }
	| { blocked: true; reason: "injection" | "code"; refusal: string; signals: string[] };

export type GuardRule = { category: "injection" | "code"; pattern: string; signal: string; enabled: number };

// Fallback kalau tabel kosong/gagal baca — subset pola inti, hasil audit
// false-positive produksi 21 Sep (tanpa "dan" polos, "lewat sini", "system" polos).
const FALLBACK_RULES: GuardRule[] = [
	{ category: "injection", pattern: "re:\\b(ignore|disregard|forget)\\s+(all\\s+)?(previous|prior|above|system|your)?\\s*(instructions?|prompts?|rules?)\\b", signal: "ignore-previous", enabled: 1 },
	{ category: "injection", pattern: "re:\\b(system\\s*prompt|prompt\\s*sistem|instruksi\\s*sistem|hidden\\s*prompt)\\b", signal: "system-prompt-ref", enabled: 1 },
	{ category: "injection", pattern: "re:\\b(you\\s+are\\s+(now|actually)|kamu\\s+sekarang\\s+adalah|sekarang\\s+kamu\\s+adalah)\\b", signal: "role-hijack", enabled: 1 },
	{ category: "injection", pattern: "re:\\b(jailbreak|do\\s+anything\\s+now|break\\s+out|keluar\\s+dari\\s+aturan)\\b", signal: "jailbreak", enabled: 1 },
	{ category: "injection", pattern: "re:\\bDAN\\s+(?:mode|prompt|jailbreak)\\b", signal: "jailbreak-dan", enabled: 1 },
	{ category: "injection", pattern: "re:\\b(reveal|show|tampilkan|tunjukkan|bocor)(kan)?\\s+(your|kamu|the)?\\s*(system\\s*|hidden\\s+)?(prompt|instructions?|system\\s+aturan|aturan\\s+sistem|instruksi\\s+sistem)\\b", signal: "reveal-prompt", enabled: 1 },
	{ category: "injection", pattern: "re:\\b(override|timpa|lewati|abaikan)\\s+(aturan|rules|instructions|prompt|batasan|constraints)\\b", signal: "override-rules", enabled: 1 },
	{ category: "injection", pattern: "re:\\b(no\\s+restrictions?|tanpa\\s+batas|tanpa\\s+aturan|unrestricted|no\\s+rules)\\b", signal: "no-restrictions", enabled: 1 },
	{ category: "code", pattern: "re:\\b(m{0,2}buat(?:kan|in|ain)?|tulis|kerjakan|bikin|generate|berikan)\\b[^\\n]{0,40}\\b(kode|code|skrip|script|function|fungsi|python|javascript|typescript|php|java|html|css|react)\\b", signal: "write-code", enabled: 1 },
	{ category: "code", pattern: "re:\\b(hack|exploit|vulnerability|celah\\s+keamanan|reverse\\s+engineer|decompile)\\b", signal: "security-attack", enabled: 1 },
	{ category: "code", pattern: "re:```[a-z]*", signal: "code-fence-request", enabled: 1 },
];

const EVENT_CONTEXT = /\b(event|acara|kegiatan|formulir|form|pendaftaran|seminar|lomba|rapat|workshop|talk\s?show)\b/i;

// Naming an event must not exempt an explicit request to write executable code.
const EXPLICIT_CODE_REQUEST = /\b(tulis|buat(?:kan|in|ain)?|bikin|generate|berikan|write)\s+(?:(?:saya|aku|contoh|sebuah|some)\s+){0,2}(kode|code|skrip|script|function)\b/i;

// ---- Loader + cache ---------------------------------------------------------

type CompiledRule = { category: "injection" | "code"; re: RegExp; signal: string; raw: string };

export const compileGuardRule = (r: { category: string; pattern: string; signal: string; enabled: number }): CompiledRule | null => {
	if (!r.enabled || !r.pattern.trim() || !["code", "injection"].includes(r.category)) return null;
	const cat = r.category === "code" ? "code" : "injection";
	try {
		if (r.pattern.startsWith("re:")) {
			// Seluruh alternatif dalam satu aturan harus ikut diperiksa.
			const re = new RegExp(r.pattern.slice(3).split("||").map((part) => `(?:${part})`).join("|"), "i");
			return { category: cat, signal: r.signal, raw: r.pattern, re };
		}
		const esc = r.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		return { category: cat, signal: r.signal, raw: r.pattern, re: new RegExp(esc, "i") };
	} catch {
		return null; // pola rusak dari DB — skip, jangan bikin chat 500
	}
};

// ponytail: regex gabung tidak bisa — tiap rule perlu signal sendiri; tes berurutan.
const matchAll = (rules: CompiledRule[], text: string): string[] =>
	rules.filter((r) => r.re.test(text)).map((r) => r.signal);

export const loadGuardRules = async (db: Db): Promise<CompiledRule[]> => {
	const key = "__roro_guard_rules";
	const cached = (globalThis as any)[key] as { rules: CompiledRule[]; at: number } | undefined;
	if (cached && Date.now() - cached.at < 60_000) return cached.rules;
	let rows: Array<{ category: string; pattern: string; signal: string; enabled: number }> = [];
	try {
		rows = await db
			.select({ category: aiGuardRules.category, pattern: aiGuardRules.pattern, signal: aiGuardRules.signal, enabled: aiGuardRules.enabled })
			.from(aiGuardRules)
			.where(eq(aiGuardRules.enabled, 1));
	} catch {
		rows = []; // tabel belum ada (migrasi belum jalan) — fallback
	}
	let rules = rows.map(compileGuardRule).filter(Boolean) as CompiledRule[];
	if (!rules.length) rules = FALLBACK_RULES.map(compileGuardRule).filter(Boolean) as CompiledRule[];
	(globalThis as any)[key] = { rules, at: Date.now() };
	return rules;
};

export const precheckWithRules = (raw: string, rules: CompiledRule[]): PrecheckResult => {
	const text = raw.slice(0, 8000).normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "");

	// (1) Injeksi prompt — cek dulu, paling berbahaya.
	const injSignals = matchAll(
		rules.filter((r) => r.category === "injection"),
		text,
	);
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
	if (!EVENT_CONTEXT.test(text) || EXPLICIT_CODE_REQUEST.test(text)) {
		const codeSignals = matchAll(
			rules.filter((r) => r.category === "code"),
			text,
		);
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

// Kompatibilitas: pemanggil lama tanpa DB — pakai fallback murni.
export const precheckUserMessage = (raw: string): PrecheckResult => precheckWithRules(raw, FALLBACK_RULES.map(compileGuardRule).filter(Boolean) as CompiledRule[]);
