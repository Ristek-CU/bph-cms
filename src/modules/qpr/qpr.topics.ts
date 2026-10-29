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
import type { QprCategory, QprInstrument, QprPair, QprV4Role, QuestionnaireV4, QuestionnaireV5, SnapshotQuestion, TopicSection } from "./qpr.schema";
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

// ── v5: matriks penilai × target ────────────────────────────────────────────

export const isMatrixSnapshot = (snapshot: { version: number }): snapshot is QuestionnaireV5 =>
	snapshot.version === 5;

export const pairKey = (pair: QprPair) => `${pair.assessor}>${pair.target}`;

const dedupePairs = (pairs: QprPair[]): QprPair[] => {
	const seen = new Map<string, QprPair>();
	for (const pair of pairs) seen.set(pairKey(pair), { assessor: pair.assessor, target: pair.target });
	return [...seen.values()];
};

/** Semua pasangan penilai → target yang bisa muncul dari routing roster. */
export function feasiblePairs(roster: TopicRosterEntry[]): QprPair[] {
	return dedupePairs(
		roster.flatMap((viewer) =>
			assesseesFor(viewer, roster).flatMap((target) =>
				viewer.role && target.role
					? [{ assessor: viewer.role as QprV4Role, target: target.role as QprV4Role }]
					: [],
			),
		),
	);
}

/** Instrumen yang dipakai untuk satu pasangan penilai → target. */
export const instrumentsFor = (
	snapshot: QuestionnaireV5,
	viewer: TopicRosterEntry,
	target: TopicRosterEntry,
): QprInstrument[] => {
	if (!viewer.role || !target.role) return [];
	return snapshot.instruments.filter((instrument) =>
		instrument.applies.some((pair) => pair.assessor === viewer.role && pair.target === target.role),
	);
};

type QuestionGroup = { id: string; title: string; questions: SnapshotQuestion[] };

const sectionFromGroups = (target: TopicRosterEntry, groups: QuestionGroup[]): TopicSection => ({
	id: target.id,
	title: sectionTitle(target),
	targetId: target.id,
	targetLabel: target.name,
	questions: groups.flatMap((group) =>
		group.questions.map((question) => ({
			...question,
			id: targetQuestionId(target.id, question.id),
			category: group.title,
			category_id: group.id,
		})),
	),
});

/**
 * Pertanyaan untuk satu orang yang dinilai.
 * v4: cukup target (kategori difilter `scope`).
 * v5: butuh viewer karena instrumen dipilih dari pasangan penilai → target.
 */
export function sectionForTarget(
	snapshot: QuestionnaireV4 | QuestionnaireV5,
	target: TopicRosterEntry,
	viewer?: TopicRosterEntry,
): TopicSection {
	const groups: QuestionGroup[] = isMatrixSnapshot(snapshot)
		? viewer
			? instrumentsFor(snapshot, viewer, target).map(({ id, title, questions }) => ({ id, title, questions }))
			: []
		: snapshot.categories
				.filter((category) => appliesTo(category, target))
				.map(({ id, title, questions }) => ({ id, title, questions }));
	return sectionFromGroups(target, groups);
}

/**
 * Superset semua section target satu periode — dipakai rekap & ekspor, yang
 * tidak punya satu viewer. v5: gabungan semua instrumen yang menyasar jabatan
 * target itu; ID pertanyaan tetap unik per target sehingga agregasi aman.
 */
export const allTargetSections = (snapshot: QuestionnaireV4 | QuestionnaireV5, roster: TopicRosterEntry[]): TopicSection[] =>
	roster
		.map((target) => {
			if (!isMatrixSnapshot(snapshot)) return sectionForTarget(snapshot, target);
			const groups = snapshot.instruments
				.filter((instrument) => instrument.applies.some((pair) => pair.target === target.role))
				.map(({ id, title, questions }) => ({ id, title, questions }));
			return sectionFromGroups(target, groups);
		})
		.filter((section) => section.questions.length > 0);

/** Satu langkah pengisian = satu orang yang dinilai. */
export function sectionsFor(
	snapshot: QuestionnaireV4 | QuestionnaireV5,
	viewer: TopicRosterEntry,
	roster: TopicRosterEntry[],
): TopicSection[] {
	return assesseesFor(viewer, roster)
		.map((assessee) => sectionForTarget(snapshot, assessee, viewer))
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

/** Buat snapshot v5 dari input klien. ID instrumen/pertanyaan dibuat server. */
export function buildMatrixSnapshot(
	instruments: Array<{
		title: string;
		applies?: QprPair[];
		questions: Array<{ type: "scale" | "text"; label: string; required?: boolean }>;
	}>,
	previous?: QuestionnaireV5,
): QuestionnaireV5 {
	return {
		version: 5,
		instruments: instruments.map((instrument, index) => {
			const instrumentId = `inst-${index + 1}`;
			const retained = previous?.instruments.find((i) => i.id === instrumentId);
			return {
				id: instrumentId,
				title: instrument.title,
				applies: dedupePairs(instrument.applies ?? []),
				questions: instrument.questions.map((question, qIndex) => ({
					// Pertahankan ID lama pada posisi yang sama supaya draft yang
					// sudah tersimpan tidak kehilangan pasangan pertanyaannya.
					id: retained?.questions[qIndex]?.id ?? `${instrumentId}-q${qIndex + 1}`,
					type: question.type,
					label: question.label,
					required: question.required ?? true,
				})),
			};
		}),
	};
}

/** Validasi struktur v5 (bukan kelengkapan publikasi). */
export function validateMatrix(snapshot: QuestionnaireV5): string[] {
	const errors: string[] = [];
	if (snapshot.instruments.length > 40) errors.push("Maksimal 40 instrumen penilaian");
	const instrumentIds = new Set<string>();
	const questionIds = new Set<string>();
	for (const instrument of snapshot.instruments) {
		if (!instrument.title.trim()) errors.push(`Instrumen tanpa judul: ${instrument.id}`);
		if (instrumentIds.has(instrument.id)) errors.push(`ID instrumen berulang: ${instrument.id}`);
		instrumentIds.add(instrument.id);
		if (instrument.questions.length > 100) errors.push(`${instrument.title}: maksimal 100 pertanyaan`);
		const seenPairs = new Set<string>();
		for (const pair of instrument.applies) {
			const key = pairKey(pair);
			if (seenPairs.has(key)) errors.push(`${instrument.title}: pasangan ${key} berulang`);
			seenPairs.add(key);
		}
		for (const question of instrument.questions) {
			if (!question.id.trim() || /\s/.test(question.id)) errors.push(`ID pertanyaan tidak valid: ${question.id}`);
			// ID harus unik lintas instrumen: rekap mengagregasi per question_id.
			if (questionIds.has(question.id)) errors.push(`ID pertanyaan berulang: ${question.id}`);
			questionIds.add(question.id);
			if (!question.label.trim()) errors.push(`Pertanyaan tanpa teks di ${instrument.title}`);
		}
	}
	return [...new Set(errors)];
}

/** Validasi dasar roster yang berlaku untuk v4 & v5. */
const rosterBlockers = (roster: TopicRosterEntry[]): string[] => {
	const errors: string[] = [];
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
		}
	}
	return errors;
};

/** Validasi struktur (bukan kelengkapan publikasi) untuk v4. */
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

function topicPublishBlockersV4(snapshot: QuestionnaireV4, roster: TopicRosterEntry[]): string[] {
	const errors = validateTopicCategories(snapshot);
	for (const category of snapshot.categories) {
		if (!category.questions.length) errors.push(`Kategori "${category.title}" belum punya pertanyaan`);
	}
	errors.push(...rosterBlockers(roster));
	for (const entry of roster) {
		if (!QPR_V4_ROLES.includes(entry.role as QprV4Role)) continue;
		if (entry.role !== "president" && entry.role !== "vice_president" && !entry.divisionSlug) continue;
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

/**
 * Blocker publikasi v5: setiap pasangan yang MUNGKIN muncul dari roster harus
 * punya minimal satu instrumen berisi pertanyaan — kalau tidak, ada orang yang
 * dinilai dengan form kosong.
 */
export function matrixPublishBlockers(snapshot: QuestionnaireV5, roster: TopicRosterEntry[]): string[] {
	const errors = validateMatrix(snapshot);
	if (!snapshot.instruments.length) errors.push("Belum ada instrumen penilaian");
	for (const instrument of snapshot.instruments) {
		if (!instrument.questions.length) errors.push(`Instrumen "${instrument.title}" belum punya pertanyaan`);
		if (!instrument.applies.length) errors.push(`Instrumen "${instrument.title}" belum dipakai pasangan penilai → target`);
	}
	errors.push(...rosterBlockers(roster));
	const covered = new Set<string>();
	for (const instrument of snapshot.instruments) {
		if (!instrument.questions.length) continue;
		for (const pair of instrument.applies) covered.add(pairKey(pair));
	}
	for (const pair of feasiblePairs(roster)) {
		if (covered.has(pairKey(pair))) continue;
		const assessor = QPR_V4_ROLE_LABEL[pair.assessor] ?? pair.assessor;
		const target = QPR_V4_ROLE_LABEL[pair.target] ?? pair.target;
		errors.push(`Pasangan ${assessor} → ${target} belum punya pertanyaan`);
	}
	for (const entry of roster) {
		if (!QPR_V4_ROLES.includes(entry.role as QprV4Role)) continue;
		if (entry.role !== "president" && entry.role !== "vice_president" && !entry.divisionSlug) continue;
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

/** Ubah snapshot v4 ke v5 tanpa mengubah pertanyaan (dipakai endpoint upgrade). */
export function migrateV4ToV5(snapshot: QuestionnaireV4, roster: TopicRosterEntry[]): QuestionnaireV5 {
	const feasible = feasiblePairs(roster);
	return {
		version: 5,
		instruments: snapshot.categories.map((category) => ({
			id: category.id,
			title: category.title,
			// `positions` = semua target jabatan (bukan anggota), sama seperti v4.
			applies: feasible.filter((pair) => category.scope === "all" || pair.target !== "anggota"),
			questions: category.questions,
		})),
	};
}

/**
 * Blocker publikasi: form tidak boleh dibuka kalau roster belum bisa
 * menghasilkan jalur penilaian yang lengkap.
 */
export function topicPublishBlockers(
	snapshot: QuestionnaireV4 | QuestionnaireV5,
	roster: TopicRosterEntry[],
): string[] {
	return isMatrixSnapshot(snapshot) ? matrixPublishBlockers(snapshot, roster) : topicPublishBlockersV4(snapshot, roster);
}

/** Ringkas isi kategori untuk label editor. */
export const topicSummary = (category: QprCategory) => {
	const scale = category.questions.filter((q) => q.type === "scale").length;
	const text = category.questions.filter((q) => q.type === "text").length;
	return { scale, text, total: category.questions.length };
};
