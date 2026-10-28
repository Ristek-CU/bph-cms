/**
 * Skoring QPR — akumulasi poin per respons.
 *
 * Model poin (keputusan produk): pertanyaan skala 1–5 menyumbang nilai yang
 * dipilih (tanpa bobot per opsi); pertanyaan teks/esai tidak menyumbang poin.
 * Total poin seorang pengisi = jumlah nilai skala semua pertanyaan jalurnya.
 *
 * Modul ini murni (tanpa DB) supaya bisa diuji terpisah dan dipakai baik saat
 * submit maupun saat rekap.
 */
import type { SnapshotQuestion } from "./qpr.schema";

export type ScoredAnswer = { question_id: string; value: number | string };

export type ResponseScore = {
	/** Total poin = akumulasi nilai skala yang valid. */
	total: number;
	/** Poin per question_id (hanya pertanyaan skala). */
	per_question: Record<string, number>;
};

/**
 * Hitung poin dari jawaban terhadap daftar pertanyaan jalur responden.
 * Jawaban teks diabaikan; nilai skala di luar 1–5 (atau bukan integer) diabaikan
 * agar rekap tidak tercemar data lama/liar.
 */
export const scoreResponse = (questions: SnapshotQuestion[], answers: ScoredAnswer[]): ResponseScore => {
	const byId = new Map(questions.map((q) => [q.id, q]));
	const per_question: Record<string, number> = {};
	let total = 0;
	const seen = new Set<string>();
	for (const a of answers) {
		if (seen.has(a.question_id)) continue;
		seen.add(a.question_id);
		const question = byId.get(a.question_id);
		if (!question || question.type !== "scale") continue;
		if (typeof a.value !== "number" || !Number.isInteger(a.value) || a.value < 1 || a.value > 5) continue;
		per_question[a.question_id] = a.value;
		total += a.value;
	}
	return { total, per_question };
};