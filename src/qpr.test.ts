/**
 * Self-check modul QPR v2 — tanpa login (model kejujuran).
 * Alur: BPH buat periode + roster nama → buka → publik lihat roster →
 * submit by nama → nama hilang dari roster → submit ulang 409 →
 * nama tak terdaftar 422 → rekap partisipasi + rata-rata → guard admin.
 * Run: tsx src/qpr.test.ts
 */
import { startHarness, type Harness } from "./test/harness";

let passed = 0;
let failed = 0;
const failures: string[] = [];

const ok = (label: string, condition: boolean, detail?: unknown) => {
	if (condition) {
		passed++;
		console.log(`ok   ${label}`);
	} else {
		failed++;
		failures.push(label);
		console.error(`FAIL ${label}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
	}
};
const eq = (label: string, actual: unknown, expected: unknown) =>
	ok(label, JSON.stringify(actual) === JSON.stringify(expected), { expected, actual });
const section = (name: string) => console.log(`\n── ${name}`);

const h: Harness = await startHarness();

const ADMIN = "/api/v1/admin/qpr";
const PUB = "/api/v1/qpr";

// ── Akses admin ─────────────────────────────────────────────────────────────
section("Akses");

// Periode legacy (form_kind default dari migrasi 0015) tetap terbaca penuh.
await h.sql(
	`INSERT INTO qpr_periods (id, title, questions, status, created_by_user_id, created_at, updated_at)
	 VALUES ('legacy-periode-1', 'Legacy Sep 2026', '[{"label":"Menyelesaikan tugas tepat waktu","category":"Kinerja"}]', 'open', 'u-bph', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')`,
);
await h.sql(
	`INSERT INTO qpr_entries (id, period_id, name, division, done, created_at)
	 VALUES ('legacy-entry-1', 'legacy-periode-1', 'Raka Legacy', 'Ristek', 1, '2026-09-01T00:00:00Z')`,
);
await h.sql(
	`INSERT INTO qpr_answers (id, entry_id, answers, submitted_at)
	 VALUES ('legacy-answer-1', 'legacy-entry-1', '[{"label":"Menyelesaikan tugas tepat waktu","category":"Kinerja","score":4}]', '2026-09-01T00:00:00Z')`,
);
const legacyList = await h.req(`${ADMIN}/periods`, { token: "tok-bph" });
const legacyPeriod = legacyList.body?.data?.find((p: any) => p.id === "legacy-periode-1");
ok("periode legacy terbaca di list", Boolean(legacyPeriod));
eq("periode legacy form_kind=legacy", legacyPeriod?.formKind, "legacy");
const legacyRoster = await h.req(`${PUB}/legacy-periode-1`);
eq("roster publik periode legacy → 200", legacyRoster.status, 200);
eq("nama legacy done hilang dari roster", legacyRoster.body?.data?.remaining?.length, 0);

const noAuth = await h.req(`${ADMIN}/periods`, { method: "POST", json: { title: "x", questions: [{ label: "a", category: "b" }] } });
eq("tanpa token → 401", noAuth.status, 401);
const nonBph = await h.req(`${ADMIN}/periods`, { token: "tok-a-admin" });
eq("division_admin kelola → 403", nonBph.status, 403);
const paNonBph = await h.req(`${ADMIN}/periods`, { token: "tok-pa-nonbph" });
eq("platform_admin non-BPH kelola → 403", paNonBph.status, 403);
const paNonBphRecap = await h.req(`${ADMIN}/periods/p/rest` && `${ADMIN}/periods/00000000-0000-0000-0000-000000000000/recap`, { token: "tok-pa-nonbph" });
eq("platform_admin non-BPH rekap → 403 (bukan 404)", paNonBphRecap.status, 403);

// ── BPH: periode + roster ───────────────────────────────────────────────────
section("Periode & roster (BPH)");

const QUESTIONS = [
	{ label: "Menyelesaikan tugas tepat waktu", category: "Kinerja" },
	{ label: "Berkolaborasi dengan baik", category: "Kolaborasi" },
];

const created = await h.req(`${ADMIN}/periods`, {
	token: "tok-bph",
	method: "POST",
	json: { title: "Penilaian September 2026", description: "Menilai: Ketua Ristek", questions: QUESTIONS, closes_at: "2026-12-31T23:59:59+07:00" },
});
eq("buat periode → 201", created.status, 201);
eq("status awal draft", created.body?.data?.status, "draft");
const pid = created.body?.data?.id;

// Draft → publik 404
const draftPublic = await h.req(`${PUB}/${pid}`);
eq("draft → publik 404", draftPublic.status, 404);

const entries = await h.req(`${ADMIN}/periods/${pid}/entries`, {
	token: "tok-bph",
	method: "POST",
	json: { entries: [{ name: "Raka Pratama", division: "Ristek" }, { name: "Sinta Dewi", division: "Ristek" }, { name: "Budi Santoso", division: "UKM" }] },
});
eq("tambah 3 nama → 201", entries.status, 201);

const dupName = await h.req(`${ADMIN}/periods/${pid}/entries`, {
	token: "tok-bph",
	method: "POST",
	json: { entries: [{ name: "raka pratama" }] },
});
eq("nama duplikat → 409", dupName.status, 409);

await h.req(`${ADMIN}/periods/${pid}/open`, { token: "tok-bph", method: "POST" });

// ── Publik: roster → submit → hilang ────────────────────────────────────────
section("Alur publik no-login");

const roster = await h.req(`${PUB}/${pid}`);
eq("roster publik → 200", roster.status, 200);
eq("3 nama tersisa", roster.body?.data?.remaining?.length, 3);
ok("roster bawa pertanyaan", roster.body?.data?.questions?.length === 2);
ok("roster tanpa done flag per nama", roster.body?.data?.remaining?.every((r: any) => r.done === undefined), roster.body?.data?.remaining);

const submit = await h.req(`${PUB}/${pid}/submit`, {
	method: "POST",
	json: {
		name: "Raka Pratama",
		answers: [
			{ label: QUESTIONS[0].label, category: "Kinerja", score: 4 },
			{ label: QUESTIONS[1].label, category: "Kolaborasi", score: 5, note: "Sangat membantu" },
		],
	},
});
eq("submit by nama → 200", submit.status, 200);

const roster2 = await h.req(`${PUB}/${pid}`);
eq("setelah submit, nama hilang (2 tersisa)", roster2.body?.data?.remaining?.length, 2);
ok("Raka tidak lagi di roster", !roster2.body?.data?.remaining?.some((r: any) => r.name === "Raka Pratama"));

const resubmit = await h.req(`${PUB}/${pid}/submit`, { method: "POST", json: { name: "Raka Pratama", answers: QUESTIONS.map((q) => ({ label: q.label, category: q.category, score: 3 })) } });
eq("submit nama yang sudah isi → 409", resubmit.status, 409);
const garbage = await h.req(`${PUB}/${pid}/submit`, { method: "POST", json: { name: "Sinta Dewi", answers: [{ label: "x", category: "y", score: 3 }] } });
eq("jawaban tak sesuai pertanyaan → 422", garbage.status, 422);

const unknown = await h.req(`${PUB}/${pid}/submit`, { method: "POST", json: { name: "Orang Luar", answers: [{ label: "x", category: "y", score: 3 }] } });
eq("nama tak terdaftar → 422", unknown.status, 422);

const badScore = await h.req(`${PUB}/${pid}/submit`, {
	method: "POST",
	json: { name: "Sinta Dewi", answers: [{ label: "x", category: "y", score: 9 }] },
});
eq("score di luar 1-5 → 422", badScore.status, 422);

// ── Tutup periode ───────────────────────────────────────────────────────────
section("Tutup periode");

await h.req(`${ADMIN}/periods/${pid}/close`, { token: "tok-bph", method: "POST" });
const closedRoster = await h.req(`${PUB}/${pid}`);
eq("periode tutup → publik 404", closedRoster.status, 404);
const closedSubmit = await h.req(`${PUB}/${pid}/submit`, { method: "POST", json: { name: "Sinta Dewi", answers: [{ label: "x", category: "y", score: 3 }] } });
eq("submit setelah tutup → 404", closedSubmit.status, 404);

// ── Rekap ───────────────────────────────────────────────────────────────────
section("Rekap");

// Buka lagi untuk isi 1 nama lain, lalu rekap
await h.req(`${ADMIN}/periods/${pid}/open`, { token: "tok-bph", method: "POST" });
await h.req(`${PUB}/${pid}/submit`, {
	method: "POST",
	json: {
		name: "Sinta Dewi",
		answers: [{ label: QUESTIONS[0].label, category: "Kinerja", score: 2 }, { label: QUESTIONS[1].label, category: "Kolaborasi", score: 3 }],
		note: "Tetap semangat!",
	},
});

const recap = await h.req(`${ADMIN}/periods/${pid}/recap`, { token: "tok-bph" });
eq("rekap → 200", recap.status, 200);
eq("total 3 nama", recap.body?.data?.total_entries, 3);
eq("2 sudah isi", recap.body?.data?.done_entries, 2);
eq("1 pending: Budi", recap.body?.data?.pending?.length, 1);
eq("pending nama Budi", recap.body?.data?.pending?.[0]?.name, "Budi Santoso");
eq("rata-rata Kinerja (4+2)/2 = 3", recap.body?.data?.category_averages?.["Kinerja"], 3);
eq("rata-rata Kolaborasi (5+3)/2 = 4", recap.body?.data?.category_averages?.["Kolaborasi"], 4);
eq("rata-rata keseluruhan 3.5", recap.body?.data?.overall_average, 3.5);
ok("catatan ikut rekap", recap.body?.data?.notes?.includes("Sangat membantu"), recap.body?.data?.notes);
const recapDenied = await h.req(`${ADMIN}/periods/${pid}/recap`, { token: "tok-a-admin" });
eq("rekap oleh non-BPH → 403", recapDenied.status, 403);
const recapPaNonBph = await h.req(`${ADMIN}/periods/${pid}/recap`, { token: "tok-pa-nonbph" });
eq("rekap oleh platform_admin non-BPH → 403", recapPaNonBph.status, 403);

// ── Delete guard ────────────────────────────────────────────────────────────
section("Delete guard");

const delWithAnswers = await h.req(`${ADMIN}/periods/${pid}`, { token: "tok-bph", method: "DELETE" });
eq("hapus periode bersubmission → 409", delWithAnswers.status, 409);
const budi = (await h.req(`${ADMIN}/periods/${pid}`, { token: "tok-bph" })).body?.data?.entries?.find((e: any) => e.name === "Budi Santoso");
const delEntry = await h.req(`${ADMIN}/periods/${pid}/entries/${budi?.id}`, { token: "tok-bph", method: "DELETE" });
eq("hapus nama belum isi → 200", delEntry.status, 200);
const delNow = await h.req(`${ADMIN}/periods/${pid}`, { token: "tok-bph", method: "DELETE" });
eq("hapus periode masih ada submission → tetap 409", delNow.status, 409);

// ── Entry final tak boleh dihapus (T1) ──────────────────────────────────────
section("Entry final protected");

const entries2 = await h.req(`${ADMIN}/periods/${pid}`, { token: "tok-bph" });
const raka = entries2.body?.data?.entries?.find((e: any) => e.name === "Raka Pratama");
ok("Raka punya entry final", Boolean(raka?.done));
const delFinal = await h.req(`${ADMIN}/periods/${pid}/entries/${raka?.id}`, { token: "tok-bph", method: "DELETE" });
eq("hapus nama sudah isi → 409", delFinal.status, 409);
const stillThere = await h.req(`${ADMIN}/periods/${pid}`, { token: "tok-bph" });
ok("Raka masih ada setelah attempt hapus", stillThere.body?.data?.entries?.some((e: any) => e.name === "Raka Pratama"));

// ── Template BPH (T3) ───────────────────────────────────────────────────────
section("Template BPH");

const bphCreated = await h.req(`${ADMIN}/periods`, {
	token: "tok-bph",
	method: "POST",
	json: { form_kind: "bph", title: "QPR BPH Oktober 2026", description: "Penilaian pengurus BPH" },
});
eq("buat periode bph (tanpa questions) → 201", bphCreated.status, 201);
eq("form_kind=bph", bphCreated.body?.data?.formKind, "bph");
const bphQ = bphCreated.body?.data?.questions;
eq("snapshot v2", bphQ?.version, 2);
eq("7 section", bphQ?.sections?.length, 7);
ok(
	"tiap section 20 skala + 2 teks",
	bphQ?.sections?.every((s: any) => s.questions.filter((q: any) => q.type === "scale").length === 20 && s.questions.filter((q: any) => q.type === "text").length === 2),
	bphQ?.sections?.map((s: any) => [s.targetId, s.questions.length]),
);
const waketum = bphQ?.sections?.find((s: any) => s.targetId === "waketum");
ok("waketum s17/s18 wording sama", waketum?.questions?.[16]?.label === waketum?.questions?.[17]?.label);
ok("waketum s17/s18 ID beda", waketum?.questions?.[16]?.id !== waketum?.questions?.[17]?.id);

// Resolver: jalur responden konsisten dengan template
const { resolveBphPath } = await import("./modules/qpr/qpr.templates");
const pathKadiv = resolveBphPath("kadiv", { controllers: ["controller"], bendahara: [], sekretaris: [] });
eq("kadiv → controller+ketum+waketum", pathKadiv.length, 3);
const pathSekdiv2 = resolveBphPath("sekdiv", { controllers: [], bendahara: [], sekretaris: ["sekum1", "sekum2"] });
eq("sekdiv 2 sekum → 4 target", pathSekdiv2.length, 4);

// Legacy tanpa questions tetap ditolak (bukan form bph)
const noQ = await h.req(`${ADMIN}/periods`, { token: "tok-bph", method: "POST", json: { title: "Tanpa pertanyaan" } });
eq("legacy tanpa questions → 422", noQ.status, 422);

// ── Draft + CAS (T5) ────────────────────────────────────────────────────────
section("Draft server + CAS");

const bphPid = bphCreated.body?.data?.id;
// Roster entry dengan role kadiv (jalur: controller + ketum + waketum = 66 wajib)
const bphEntries = await h.req(`${ADMIN}/periods/${bphPid}/entries`, {
	token: "tok-bph",
	method: "POST",
	json: { entries: [{ name: "Diva Kadiv", division: "Ristek", role: "kadiv" }, { name: "Budi Anggota", division: "Ristek" }] },
});
eq("tambah roster bph → 201", bphEntries.status, 201);
const diva = bphEntries.body?.data?.find((e: any) => e.name === "Diva Kadiv");
const budiBph = bphEntries.body?.data?.find((e: any) => e.name === "Budi Anggota");

await h.req(`${ADMIN}/periods/${bphPid}/open`, { token: "tok-bph", method: "POST" });

const draft0 = await h.req(`${PUB}/${bphPid}/entries/${diva?.id}/draft`);
eq("baca draft → 200", draft0.status, 200);
eq("draft_version awal 0", draft0.body?.data?.draft_version, 0);
eq("jalur kadiv: 3 section", draft0.body?.data?.sections?.length, 3);
ok("progress kosong", draft0.body?.data?.progress?.required === 66 && draft0.body?.data?.progress?.filled === 0, draft0.body?.data?.progress);
const q0 = draft0.body?.data?.questions?.[0];
eq("next = pertanyaan wajib pertama", draft0.body?.data?.progress?.next_question_id, q0?.id);

// Save parsial ok — tidak menandai selesai
const save1 = await h.req(`${PUB}/${bphPid}/entries/${diva?.id}/draft`, {
	method: "PUT",
	json: { expected_version: 0, answers: [{ question_id: q0?.id, value: 4 }] },
});
eq("save parsial → 200", save1.status, 200);
eq("draft_version naik ke 1", save1.body?.data?.draft_version, 1);

const rosterMid = await h.req(`${PUB}/${bphPid}`);
ok("nama masih di roster setelah draft separuh", rosterMid.body?.data?.remaining?.some((r: any) => r.name === "Diva Kadiv"));

// CAS: klien bawa versi lama → 409, draft tidak tertimpa
const stale = await h.req(`${PUB}/${bphPid}/entries/${diva?.id}/draft`, {
	method: "PUT",
	json: { expected_version: 0, answers: [{ question_id: q0?.id, value: 1 }] },
});
eq("CAS versi usang → 409", stale.status, 409);
const draft1 = await h.req(`${PUB}/${bphPid}/entries/${diva?.id}/draft`);
eq("draft versi tetap 1", draft1.body?.data?.draft_version, 1);
eq("nilai tetap 4 (tidak tertimpa 1)", draft1.body?.data?.draft?.[0]?.value, 4);

// Jawaban di luar jalur ditolak (anggota menilai controller → jalur anggota tak punya)
const outsider = await h.req(`${PUB}/${bphPid}/entries/${budiBph?.id}/draft`, {
	method: "PUT",
	json: { expected_version: 0, answers: [{ question_id: "controller-s01", value: 3 }] },
});
eq("anggota isi jalur controller → 422", outsider.status, 422);

// Draft terisolasi per entry
const budiDraft = await h.req(`${PUB}/${bphPid}/entries/${budiBph?.id}/draft`);
eq("draft Budi kosong (tidak tercemar Diva)", budiDraft.body?.data?.draft?.length, 0);

// Entry final → draft 409
await h.sql(`UPDATE qpr_entries SET done=1, submitted_at='2026-10-05T00:00:00Z' WHERE id='${diva?.id}'`);
const draftFinal = await h.req(`${PUB}/${bphPid}/entries/${diva?.id}/draft`);
eq("baca draft entry final → 409", draftFinal.status, 409);
const saveFinal = await h.req(`${PUB}/${bphPid}/entries/${diva?.id}/draft`, { method: "PUT", json: { expected_version: 1, answers: [] } });
eq("save draft entry final → 409", saveFinal.status, 409);

// ── Submit final atomik (T6) ────────────────────────────────────────────────
section("Submit v2 atomik");

const v2Pid = bphCreated.body?.data?.id;
// Budi Anggota (jalur anggota: ketum + waketum = 44 wajib)
const budiDraftV2 = await h.req(`${PUB}/${v2Pid}/entries/${budiBph?.id}/draft`);

const fullAnswers = (budiDraftV2.body?.data?.questions).map((q: any) => ({ question_id: q.id, value: q.type === "scale" ? 4 : "Baik sekali" }));

// Kurang 1 wajib → 422
const incomplete = await h.req(`${PUB}/${v2Pid}/submit-v2`, { method: "POST", json: { entry_id: budiBph?.id, answers: fullAnswers.slice(0, -1) } });
eq("jawaban kurang → 422", incomplete.status, 422);
const rosterAfterIncomplete = await h.req(`${PUB}/${v2Pid}`);
ok("nama tetap di roster setelah 422", rosterAfterIncomplete.body?.data?.remaining?.some((r: any) => r.name === "Budi Anggota"));

// Di luar jalur → 422 (draft Budi sah, tapi controller tidak)
const withForeign = [...fullAnswers, { question_id: "controller-s01", value: 3 }];
const foreign = await h.req(`${PUB}/${v2Pid}/submit-v2`, { method: "POST", json: { entry_id: budiBph?.id, answers: withForeign } });
eq("jawaban di luar jalur → 422", foreign.status, 422);

// Teks whitespace-only dianggap kurang
const emptyText = fullAnswers.map((a: any) => (a.question_id.endsWith("-t01") ? { ...a, value: "   " } : a));
const blankText = await h.req(`${PUB}/${v2Pid}/submit-v2`, { method: "POST", json: { entry_id: budiBph?.id, answers: emptyText } });
eq("teks wajib whitespace → 422", blankText.status, 422);

// Submit sukses
const okSubmit = await h.req(`${PUB}/${v2Pid}/submit-v2`, { method: "POST", json: { entry_id: budiBph?.id, answers: fullAnswers } });
eq("submit exact set → 200", okSubmit.status, 200);

// Roster hilang, draft terhapus, resubmit 409
const rosterAfterSubmit = await h.req(`${PUB}/${v2Pid}`);
ok("nama hilang setelah final", !rosterAfterSubmit.body?.data?.remaining?.some((r: any) => r.name === "Budi Anggota"));
const draftAfterFinal = await h.req(`${PUB}/${v2Pid}/entries/${budiBph?.id}/draft`);
eq("draft entry final → 409", draftAfterFinal.status, 409);
const resubmitV2 = await h.req(`${PUB}/${v2Pid}/submit-v2`, { method: "POST", json: { entry_id: budiBph?.id, answers: fullAnswers } });
eq("submit ulang → 409", resubmitV2.status, 409);
const budiRow = await h.sql(`SELECT draft_answers, done FROM qpr_entries WHERE id = '${budiBph?.id}'`);
ok("draft terhapus setelah final", budiRow[0]?.draft_answers === null && budiRow[0]?.done === 1, budiRow[0]);

// ── Konkurensi (D1 nyata, Miniflare) ────────────────────────────────────────
section("Konkurensi submit");

const entry3 = await h.req(`${ADMIN}/periods/${v2Pid}/entries`, { token: "tok-bph", method: "POST", json: { entries: [{ name: "Race Tester", division: "Ristek" }] } });
const race = entry3.body?.data?.[0];
// Dua submit paralel nama sama — tepat satu 200.
const [s1, s2] = await Promise.all([
	h.req(`${PUB}/${v2Pid}/submit-v2`, { method: "POST", json: { entry_id: race?.id, answers: fullAnswers } }),
	h.req(`${PUB}/${v2Pid}/submit-v2`, { method: "POST", json: { entry_id: race?.id, answers: fullAnswers } }),
]);
const statuses = [s1.status, s2.status].sort();
eq("2 submit paralel → tepat satu 200", JSON.stringify(statuses), JSON.stringify([200, 409]));

// Draft save + submit paralel — hasil konsisten, tidak ada crash/kebocoran
const entry4 = await h.req(`${ADMIN}/periods/${v2Pid}/entries`, { token: "tok-bph", method: "POST", json: { entries: [{ name: "Save Race", division: "Ristek" }] } });
const srace = entry4.body?.data?.[0];
const [sv, sm] = await Promise.all([
	h.req(`${PUB}/${v2Pid}/entries/${srace?.id}/draft`, { method: "PUT", json: { expected_version: 0, answers: [{ question_id: fullAnswers[0].question_id, value: 2 }] } }),
	h.req(`${PUB}/${v2Pid}/submit-v2`, { method: "POST", json: { entry_id: srace?.id, answers: fullAnswers } }),
]);
ok("save+submit paralel: submit 200 atau 409, tanpa 5xx", [200, 409].includes(sm.status) && [200, 409].includes(sv.status), { sv: sv.status, sm: sm.status });
const sraceRow = await h.sql(`SELECT done FROM qpr_entries WHERE id = '${srace?.id}'`);
ok("setelah race, state konsisten (done atau belum, bukan setengah)", sraceRow[0]?.done === (sm.status === 200 ? 1 : 0), sraceRow[0]);

// Close + submit paralel — periode tutup menolak submit
const entry5 = await h.req(`${ADMIN}/periods/${v2Pid}/entries`, { token: "tok-bph", method: "POST", json: { entries: [{ name: "Close Race", division: "Ristek" }] } });
const crace = entry5.body?.data?.[0];
const [, cs] = await Promise.all([
	h.req(`${ADMIN}/periods/${v2Pid}/close`, { token: "tok-bph", method: "POST" }),
	h.req(`${PUB}/${v2Pid}/submit-v2`, { method: "POST", json: { entry_id: crace?.id, answers: fullAnswers } }),
]);
ok("close+submit paralel: submit tidak sukses setelah tutup", [200, 404].includes(cs.status), cs.status);

// ── Rekap v2 + ekspor CSV (T8) ──────────────────────────────────────────────
section("Rekap v2 + ekspor CSV");

// Periode baru, 3 final dengan skor 1/4/5 pada pertanyaan skala pertama ketum
// + 1 draft (tidak dihitung).
const rPeriod = await h.req(`${ADMIN}/periods`, { token: "tok-bph", method: "POST", json: { form_kind: "bph", title: "QPR Rekap Test" } });
eq("buat periode rekap → 201", rPeriod.status, 201);
const rPid = rPeriod.body?.data?.id;
const rEntries = await h.req(`${ADMIN}/periods/${rPid}/entries`, {
	token: "tok-bph",
	method: "POST",
	json: { entries: [{ name: "R1", division: "D1" }, { name: "R2", division: "D1" }, { name: "R3", division: "D2" }, { name: "R4 Draft", division: "D1" }] },
});
const rIds = rEntries.body?.data?.map((e: any) => e.id);
await h.req(`${ADMIN}/periods/${rPid}/open`, { token: "tok-bph", method: "POST" });
const rDraft = await h.req(`${PUB}/${rPid}/entries/${rIds[0]}/draft`);
const rQuestions = rDraft.body?.data?.questions;
const firstScale = rQuestions.find((q: any) => q.type === "scale" && q.id.startsWith("ketum"));
const rFull = (answersValue: number) => rQuestions.map((q: any) => ({ question_id: q.id, value: q.type === "scale" ? answersValue : `Komen ${answersValue}` }));
for (const [i, val] of [1, 4, 5].entries()) {
	const s = await h.req(`${PUB}/${rPid}/submit-v2`, { method: "POST", json: { entry_id: rIds[i], answers: rFull(val) } });
	eq(`submit R${i + 1} skor ${val} → 200`, s.status, 200);
}
// R4 hanya draft — tidak boleh masuk rekap/ekspor
await h.req(`${PUB}/${rPid}/entries/${rIds[3]}/draft`, { method: "PUT", json: { expected_version: 0, answers: [{ question_id: firstScale.id, value: 5 }] } });

const rv2 = await h.req(`${ADMIN}/periods/${rPid}/recap-v2`, { token: "tok-bph" });
eq("recap-v2 → 200", rv2.status, 200);
eq("done 3", rv2.body?.data?.done_entries, 3);
const rSection = rv2.body?.data?.sections?.find((s: any) => s.target_id === "ketum");
const rQ = rSection?.questions?.find((q: any) => q.id === firstScale.id);
ok("distribusi 1/4/5 masing-masing 1", rQ?.distribution?.filter((d: any) => d.count > 0).length === 3 && rQ.distribution.every((d: any) => [1, 4, 5].includes(d.value) ? d.count === 1 : d.count === 0), rQ?.distribution);
eq("mean 3.33", rQ?.mean, 3.33);
eq("denominator 3 (bukan 4 — draft tidak dihitung)", rQ?.responses, 3);
const rText = rSection?.questions?.find((q: any) => q.type === "text");
ok("teks terkumpul 3", rText?.texts?.length === 3, rText?.texts);

// Legacy periode → recap-v2 menolak (arahkan ke recap lama)
const legacyRecap = await h.req(`${ADMIN}/periods/legacy-periode-1/recap-v2`, { token: "tok-bph" });
eq("recap-v2 periode legacy → 422", legacyRecap.status, 422);

const csvRes = await h.req(`${ADMIN}/periods/${rPid}/export`, { token: "tok-bph" });
eq("export → 200", csvRes.status, 200);
const csvText = typeof csvRes.body === "string" ? csvRes.body : "";
ok("CSV 3 baris data + header", csvText.split("\r\n").length === 4, csvText.split("\r\n").length);
	ok("kolom header pakai question_id unik", csvText.replace(/^\ufeff/, "").startsWith("\"waktu_kirim\"") && csvText.includes(firstScale.id));
ok("hanya 3 baris final (draft tidak diekspor)", !csvText.includes("R4 Draft"));

// Formula injection: teks berawalan = + - @ di-quote+prefix ' oleh Excel
const injEntry = await h.req(`${ADMIN}/periods/${rPid}/entries`, { token: "tok-bph", method: "POST", json: { entries: [{ name: "=INJECT", division: "@D" }] } });
const injId = injEntry.body?.data?.[0]?.id;
const injSubmit = await h.req(`${PUB}/${rPid}/submit-v2`, { method: "POST", json: { entry_id: injId, answers: rFull(3).map((a: any) => (a.question_id.endsWith("-t01") ? { ...a, value: "=cmd|' /C calc'!A0" } : a)) } });
eq("submit injeksi → 200", injSubmit.status, 200);
const injCsv = await h.req(`${ADMIN}/periods/${rPid}/export`, { token: "tok-bph" });
const injText = typeof injCsv.body === "string" ? injCsv.body : "";
ok("formula injection dineutralkan (prefix ')", injText.includes("'=cmd"), injText.split("\r\n").find((l: string) => l.includes("cmd")));

console.log(`\n${passed} passed, ${failed} failed`);
// Miniflare/workerd menahan event loop setelah dispose() — exit eksplisit.
process.exit(failed ? 1 : 0);
