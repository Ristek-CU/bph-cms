/**
 * QPR snapshot v4 — kategori pertanyaan + routing organisasi.
 *
 * BPH hanya menulis dua hal:
 *   1. kategori pertanyaan (Kepemimpinan, Komunikasi, Kedisiplinan, …) berisi
 *      pertanyaan skala 1–5 atau esai;
 *   2. roster: siapa pengisinya, jabatannya, divisinya, dan (khusus controller)
 *      divisi yang dia urus.
 *
 * Siapa menilai siapa TIDAK disimpan sebagai data — dihitung dari jabatan
 * pengisi + roster supaya tidak ada entri ganda dan tidak bisa disalah-setel:
 *
 *   President / Vice President → Controller, Sekum, Bendum (executive board)
 *   Controller                 → President, VP, Kadiv & Wakadiv divisi yang diurus
 *   Sekum                      → President, VP, seluruh Sekdiv
 *   Bendum                     → President, VP, seluruh Bendiv
 *   Sekdiv / Bendiv            → President, VP, Sekum/Bendum, Kadiv & Wakadiv
 *                                divisinya sendiri (mereka juga anggota divisi)
 *   Kadiv / Wakadiv            → seluruh anggota divisinya (termasuk Sekdiv &
 *                                Bendiv), President, VP, Controller yang mengurus
 *                                divisinya
 *   Anggota                    → President, VP, Kadiv & Wakadiv divisinya
 *
 * Hasil tetap anonim: yang disimpan hanya jawaban + peran/divisi pengisi
 * (untuk agregasi), tidak pernah ID/nama pengisi.
 */
import type { QprCategory, QprV4Role, QuestionnaireV4, SnapshotQuestion, TopicSection } from "./qpr.schema";
import { QPR_V4_ROLES } from "./qpr.schema";

/** Jabatan yang dikenali pada roster v4. */
export { QPR_V4_ROLES };
export type { QprV4Role };

export const QPR_V4_ROLE_LABEL: Record<string, string> = {
	president: "President",
	vice_president: "Vice President",
	controller: "Controller",
	sekum: "Sekretaris Umum",
	bendum: "Bendahara Umum",
	kadiv: "Kepala Divisi",
	wakadiv: "Wakil Kepala Divisi",
	sekdiv: "Sekretaris Divisi",
	bendiv: "Bendahara Divisi",
	anggota: "Anggota",
};

/** Batas praktis satu jalur pengisian (sama dengan batas submit 500 jawaban). */
export const TOPIC_MAX_QUESTIONS = 500;

export type TopicRosterEntry = {
	id: string;
	name: string;
	role: string | null;
	divisionSlug: string | null;
	division?: string | null;
	managedDivisions?: string[] | null;
};

const sameDivision = (a: TopicRosterEntry, b: TopicRosterEntry) =>
	Boolean(a.divisionSlug) && a.divisionSlug === b.divisionSlug;

/**
 * Daftar orang yang wajib dinilai oleh satu pengisi. Pengisi tidak pernah
 * menilai dirinya sendiri dan target duplikat dibuang.
 */
export function assesseesFor(viewer: TopicRosterEntry, roster: TopicRosterEntry[]): TopicRosterEntry[] {
	const out: TopicRosterEntry[] = [];
	const add = (entry?: TopicRosterEntry) => {
		if (!entry || entry.id === viewer.id || out.some((x) => x.id === entry.id)) return;
		out.push(entry);
	};
	const byRole = (...roles: string[]) => roster.filter((e) => roles.includes(e.role ?? ""));
	const leader = byRole("president", "vice_president");
	// Sekdiv/Bendiv adalah anggota divisinya, jadi mereka menilai kadiv & wakadiv
	// sendiri — sama seperti anggota biasa.
	const headsOfDivision = (entry: TopicRosterEntry) =>
		roster.filter((e) => ["kadiv", "wakadiv"].includes(e.role ?? "") && sameDivision(e, entry));
	const myDivisions = viewer.managedDivisions ?? [];
	switch (viewer.role) {
		case "president":
		case "vice_president":
			byRole("controller", "sekum", "bendum").forEach(add);
			break;
		case "controller":
			leader.forEach(add);
			roster.filter((e) => ["kadiv", "wakadiv"].includes(e.role ?? "") && myDivisions.includes(e.divisionSlug ?? "")).forEach(add);
			break;
		case "sekum":
			leader.forEach(add);
			byRole("sekdiv").forEach(add);
			break;
		case "bendum":
			leader.forEach(add);
			byRole("bendiv").forEach(add);
			break;
		case "kadiv":
		case "wakadiv":
			leader.forEach(add);
			// Sekdiv & Bendiv adalah anggota divisi juga, jadi ikut dinilai kadiv.
			roster.filter((e) => ["anggota", "sekdiv", "bendiv"].includes(e.role ?? "") && sameDivision(e, viewer)).forEach(add);
			roster.filter((e) => e.role === "controller" && (e.managedDivisions ?? []).includes(viewer.divisionSlug ?? "")).forEach(add);
			break;
		case "sekdiv":
			leader.forEach(add);
			byRole("sekum").forEach(add);
			headsOfDivision(viewer).forEach(add);
			break;
		case "bendiv":
			leader.forEach(add);
			byRole("bendum").forEach(add);
			headsOfDivision(viewer).forEach(add);
			break;
		case "anggota":
			leader.forEach(add);
			roster.filter((e) => ["kadiv", "wakadiv"].includes(e.role ?? "") && sameDivision(e, viewer)).forEach(add);
			break;
		default:
			break;
	}
	return out;
}

/** Kategori `positions` dilewati untuk target anggota (esai per anggota terlalu berat). */
export const appliesTo = (category: QprCategory, assessee: TopicRosterEntry) =>
	category.scope === "all" || assessee.role !== "anggota";

export const sectionTitle = (entry: TopicRosterEntry) =>
	`${QPR_V4_ROLE_LABEL[entry.role ?? ""] ?? entry.role ?? "Pengurus"}${entry.division ? ` — ${entry.division}` : ""}`;

/** ID pertanyaan unik per target: `<entryId>~<templateId>`. */
export const targetQuestionId = (entryId: string, templateId: string) => `${entryId}~${templateId}`;
export const templateQuestionId = (questionId: string) => questionId.split("~").slice(1).join("~");

/** Pertanyaan untuk satu orang yang dinilai (dipakai rekap & ekspor). */
export function sectionForTarget(snapshot: QuestionnaireV4, target: TopicRosterEntry): TopicSection {
	return {
		id: target.id,
		title: sectionTitle(target),
		targetId: target.id,
		targetLabel: target.name,
		questions: snapshot.categories.flatMap((category) =>
			appliesTo(category, target)
				? category.questions.map((question) => ({
						...question,
						id: targetQuestionId(target.id, question.id),
						category: category.title,
						category_id: category.id,
					}))
				: [],
		),
	};
}

/** Semua section target satu periode (tanpa melihat siapa pengisinya). */
export const allTargetSections = (snapshot: QuestionnaireV4, roster: TopicRosterEntry[]): TopicSection[] =>
	roster.map((target) => sectionForTarget(snapshot, target)).filter((section) => section.questions.length > 0);

/** Satu langkah pengisian = satu orang yang dinilai. */
export function sectionsFor(
	snapshot: QuestionnaireV4,
	viewer: TopicRosterEntry,
	roster: TopicRosterEntry[],
): TopicSection[] {
	return assesseesFor(viewer, roster)
		.map((assessee) => sectionForTarget(snapshot, assessee))
		.filter((section) => section.questions.length > 0);
}

/** Semua pertanyaan satu jalur pengisian (dipakai draft/submit/skor). */
export const questionsFor = (sections: TopicSection[]): SnapshotQuestion[] =>
	sections.flatMap((section) => section.questions);

// ── Penyusunan snapshot (create & editor) ───────────────────────────────────

/** Buat snapshot v4 dari input klien. ID kategori/pertanyaan dibuat server. */
export function buildTopicSnapshot(
	categories: Array<{ title: string; scope?: "all" | "positions"; questions: Array<{ type: "scale" | "text"; label: string; required?: boolean }> }>,
	previous?: QuestionnaireV4,
): QuestionnaireV4 {
	return {
		version: 4,
		categories: categories.map((category, index) => {
			const categoryId = `cat-${index + 1}`;
			const retained = previous?.categories.find((c) => c.id === categoryId);
			return {
				id: categoryId,
				title: category.title,
				scope: category.scope ?? "all",
				questions: category.questions.map((question, qIndex) => ({
					// Pertahankan ID lama pada posisi yang sama supaya draft yang
					// sudah tersimpan tidak kehilangan pasangan pertanyaannya.
					id: retained?.questions[qIndex]?.id ?? `${categoryId}-q${qIndex + 1}`,
					type: question.type,
					label: question.label,
					required: question.required ?? true,
				})),
			};
		}),
	};
}

/** Validasi struktur (bukan kelengkapan publikasi). */
export function validateTopicCategories(snapshot: QuestionnaireV4): string[] {
	const errors: string[] = [];
	const ids = new Set<string>();
	if (!snapshot.categories.length) errors.push("Minimal satu kategori penilaian");
	if (snapshot.categories.length > 20) errors.push("Maksimal 20 kategori penilaian");
	for (const category of snapshot.categories) {
		if (!category.title.trim()) errors.push(`Kategori tanpa judul: ${category.id}`);
		if (ids.has(category.id)) errors.push(`ID kategori berulang: ${category.id}`);
		ids.add(category.id);
		if (category.questions.length > 100) errors.push(`${category.title}: maksimal 100 pertanyaan`);
		for (const question of category.questions) {
			if (!question.id.trim() || /\s/.test(question.id)) errors.push(`ID pertanyaan tidak valid: ${question.id}`);
			if (ids.has(question.id)) errors.push(`ID pertanyaan berulang: ${question.id}`);
			ids.add(question.id);
			if (!question.label.trim()) errors.push(`Pertanyaan tanpa teks di ${category.title}`);
		}
	}
	return [...new Set(errors)];
}

/**
 * Blocker publikasi: form tidak boleh dibuka kalau roster belum bisa
 * menghasilkan jalur penilaian yang lengkap.
 */
export function topicPublishBlockers(snapshot: QuestionnaireV4, roster: TopicRosterEntry[]): string[] {
	const errors = validateTopicCategories(snapshot);
	for (const category of snapshot.categories) {
		if (!category.questions.length) errors.push(`Kategori "${category.title}" belum punya pertanyaan`);
	}
	if (!roster.length) errors.push("Roster belum diisi");
	if (!roster.some((e) => e.role === "president")) errors.push("Roster belum berisi President");
	if (!roster.some((e) => e.role === "vice_president")) errors.push("Roster belum berisi Vice President");
	for (const entry of roster.filter((e) => e.role === "controller")) {
		if (!(entry.managedDivisions ?? []).length) errors.push(`Controller ${entry.name} belum memilih divisi yang diurus`);
	}
	for (const entry of roster) {
		if (!QPR_V4_ROLES.includes(entry.role as QprV4Role)) {
			errors.push(`${entry.name}: jabatan "${entry.role ?? "—"}" tidak dikenal`);
			continue;
		}
		if (entry.role !== "president" && entry.role !== "vice_president" && !entry.divisionSlug) {
			errors.push(`${entry.name}: divisi belum diisi`);
			continue;
		}
		let sections: TopicSection[];
		try {
			sections = sectionsFor(snapshot, entry, roster);
		} catch (error) {
			errors.push(`${entry.name}: ${(error as Error).message}`);
			continue;
		}
		if (!sections.length) {
			errors.push(`${entry.name}: belum ada target yang bisa dinilai`);
			continue;
		}
		const total = sections.reduce((n, section) => n + section.questions.length, 0);
		if (total > TOPIC_MAX_QUESTIONS) errors.push(`${entry.name}: ${total} pertanyaan melebihi batas ${TOPIC_MAX_QUESTIONS}`);
	}
	return [...new Set(errors)];
}

/** Ringkas isi kategori untuk label editor. */
export const topicSummary = (category: QprCategory) => {
	const scale = category.questions.filter((q) => q.type === "scale").length;
	const text = category.questions.filter((q) => q.type === "text").length;
	return { scale, text, total: category.questions.length };
};
