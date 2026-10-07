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
eq("roster pernah dibuka terkunci → 409", delEntry.status, 409);
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
eq("snapshot v3", bphQ?.version, 3);
eq("10 section", bphQ?.sections?.length, 10);
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
// Historical v2 fixture: preserve original path and optional final version.
const { buildBphSections } = await import("./modules/qpr/qpr.templates");
await h.sql(`UPDATE qpr_periods SET questions=? WHERE id=?`, JSON.stringify({version:2,sections:buildBphSections()}), bphPid);
// Roster entry dengan role kadiv (jalur: controller + ketum + waketum = 66 wajib)
const bphEntries = await h.req(`${ADMIN}/periods/${bphPid}/entries`, {
	token: "tok-bph",
	method: "POST",
	json: { entries: [{ name: "Diva Kadiv", division: "Ristek", role: "kadiv" }, { name: "Budi Anggota", division: "Ristek" }, { name: "Race Tester" }, { name: "Save Race" }, { name: "Close Race" }] },
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

const race = bphEntries.body?.data?.find((e: any) => e.name === "Race Tester");
// Dua submit paralel nama sama — tepat satu 200.
const [s1, s2] = await Promise.all([
	h.req(`${PUB}/${v2Pid}/submit-v2`, { method: "POST", json: { entry_id: race?.id, answers: fullAnswers } }),
	h.req(`${PUB}/${v2Pid}/submit-v2`, { method: "POST", json: { entry_id: race?.id, answers: fullAnswers } }),
]);
const statuses = [s1.status, s2.status].sort();
eq("2 submit paralel → tepat satu 200", JSON.stringify(statuses), JSON.stringify([200, 409]));

// Draft save + submit paralel — hasil konsisten, tidak ada crash/kebocoran
const srace = bphEntries.body?.data?.find((e: any) => e.name === "Save Race");
const [sv, sm] = await Promise.all([
	h.req(`${PUB}/${v2Pid}/entries/${srace?.id}/draft`, { method: "PUT", json: { expected_version: 0, answers: [{ question_id: fullAnswers[0].question_id, value: 2 }] } }),
	h.req(`${PUB}/${v2Pid}/submit-v2`, { method: "POST", json: { entry_id: srace?.id, answers: fullAnswers } }),
]);
ok("save+submit paralel: submit 200 atau 409, tanpa 5xx", [200, 409].includes(sm.status) && [200, 409].includes(sv.status), { sv: sv.status, sm: sm.status });
const sraceRow = await h.sql(`SELECT done FROM qpr_entries WHERE id = '${srace?.id}'`);
ok("setelah race, state konsisten (done atau belum, bukan setengah)", sraceRow[0]?.done === (sm.status === 200 ? 1 : 0), sraceRow[0]);

// Close + submit paralel — periode tutup menolak submit
const crace = bphEntries.body?.data?.find((e: any) => e.name === "Close Race");
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
await h.sql(`UPDATE qpr_periods SET questions=? WHERE id=?`, JSON.stringify({version:2,sections:buildBphSections()}), rPid);
const rEntries = await h.req(`${ADMIN}/periods/${rPid}/entries`, {
	token: "tok-bph",
	method: "POST",
	json: { entries: [{ name: "R1", division: "D1" }, { name: "R2", division: "D1" }, { name: "R3", division: "D2" }, { name: "R4 Draft", division: "D1" }, { name: "=INJECT", division: "@D" }] },
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
const injId = rEntries.body?.data?.find((e: any) => e.name === "=INJECT")?.id;
const injSubmit = await h.req(`${PUB}/${rPid}/submit-v2`, { method: "POST", json: { entry_id: injId, answers: rFull(3).map((a: any) => (a.question_id.endsWith("-t01") ? { ...a, value: "=cmd|' /C calc'!A0" } : a)) } });
eq("submit injeksi → 200", injSubmit.status, 200);
const injCsv = await h.req(`${ADMIN}/periods/${rPid}/export`, { token: "tok-bph" });
const injText = typeof injCsv.body === "string" ? injCsv.body : "";
ok("formula injection dineutralkan (prefix ')", injText.includes("'=cmd"), injText.split("\r\n").find((l: string) => l.includes("cmd")));


section("Snapshot v3, canonical roster, freeze, privacy");
const { defaultTargetConfig } = await import("./modules/qpr/qpr.templates");
const config = defaultTargetConfig();
config.targets.forEach((t) => t.label = `Nama sintetis ${t.id}`);
// Keputusan BPH 7 Okt 2026: kadiv/wakadiv menilai KEEMPAT controller —
// controller_by_division tidak lagi menentukan routing (kosong = valid).
config.controller_by_division = {};
const v3 = await h.req(`${ADMIN}/periods`, {token:"tok-bph",method:"POST",json:{form_kind:"bph",title:"V3 regression",target_config:config}});
eq("v3 configured create", v3.status, 201);
const v3id = v3.body.data.id;
eq("v3 config PUT without form_kind",(await h.req(`${ADMIN}/periods/${v3id}`,{token:"tok-bph",method:"PUT",json:{target_config:config}})).status,200);
const v3Items = [
 {name:"Nama Kembar",role:"anggota",division_slug:"ristek",member_key:"same-1"},
 {name:"Nama Kembar",role:"anggota",division_slug:"ristek",member_key:"same-2"},
 {name:"Kadiv A",role:"kadiv",division_slug:"ristek",member_key:"ka"},
 {name:"Kadiv B",role:"wakadiv",division_slug:"ukm",member_key:"kb"},
 {name:"Bendiv",role:"bendiv",division_slug:"ristek",member_key:"bend"},
 {name:"Sekdiv",role:"sekdiv",division_slug:"ukm",member_key:"sek"},
 {name:"Rollback",role:"anggota",division_slug:"ristek",member_key:"rollback"},
 {name:"Close deterministic",role:"anggota",division_slug:"ristek",member_key:"close"},
 {name:"Offset",role:"anggota",division_slug:"ristek",member_key:"offset"},
];
const v3rows = await h.req(`${ADMIN}/periods/${v3id}/entries`, {token:"tok-bph",method:"POST",json:{entries:v3Items}});
eq("duplicate names allowed stable keys",v3rows.status,201);
const v3repeat = await h.req(`${ADMIN}/periods/${v3id}/entries`, {token:"tok-bph",method:"POST",json:{entries:v3Items}});
eq("reimport stable keys same IDs",v3repeat.body.data.map((e:any)=>e.id),v3rows.body.data.map((e:any)=>e.id));
const badRole = await h.req(`${ADMIN}/periods/${v3id}/entries`, {token:"tok-bph",method:"POST",json:{entries:[{name:"Ketum",role:"ketum",division_slug:"bph",member_key:"bad"}]}});
eq("ketum not invented respondent",badRole.status,422);
const badDivision = await h.req(`${ADMIN}/periods/${v3id}/entries`, {token:"tok-bph",method:"POST",json:{entries:[{name:"Other",role:"anggota",division_slug:"Ristek",member_key:"bad"}]}});
eq("display name not canonical division",badDivision.status,422);
const badKey = await h.req(`${ADMIN}/periods/${v3id}/entries`, {token:"tok-bph",method:"POST",json:{entries:[{name:"Missing",role:"anggota",division_slug:"ristek"}]}});
eq("v3 stable member key required",badKey.status,422);
const preview = await h.req(`${ADMIN}/periods/${v3id}/preview`,{token:"tok-bph"});
eq("preview zero blockers",preview.body.data.blockers,[]);
// Keputusan BPH: kadiv/wakadiv = 4 controller + ketum + waketum = 6 section × 22 = 132.
// anggota = 44, bendiv = 88 (2 bendum + ketum + waketum), sekdiv = 88.
eq("44/132/88/88 role paths",preview.body.data.entries.filter((e:any)=>["same-1","ka","bend","sek"].includes(e.member_key)).map((e:any)=>e.required).sort(),[132,44,88,88]);
eq("v3 open",(await h.req(`${ADMIN}/periods/${v3id}/open`,{token:"tok-bph",method:"POST"})).status,200);
const findV3=(key:string)=>v3rows.body.data.find((e:any)=>e.memberKey===key);
const frozenAdd = await h.req(`${ADMIN}/periods/${v3id}/entries`,{token:"tok-bph",method:"POST",json:{entries:v3Items}});
eq("roster import frozen",frozenAdd.status,409);
const frozenConfig=await h.req(`${ADMIN}/periods/${v3id}`,{token:"tok-bph",method:"PUT",json:{target_config:config}});
eq("target snapshot frozen",frozenConfig.status,409);
const pub3=await h.req(`${PUB}/${v3id}`);
ok("public roster no internal key/draft",pub3.body.data.remaining.every((e:any)=>e.member_key===undefined&&e.memberKey===undefined&&e.draftAnswers===undefined));
ok("duplicate names display distinct",new Set(pub3.body.data.remaining.filter((e:any)=>e.name==="Nama Kembar").map((e:any)=>e.display_name)).size===2);
ok("roster no-store",pub3.headers.get("Cache-Control")?.includes("no-store")===true);
const da=await h.req(`${PUB}/${v3id}/entries/${findV3("ka").id}/draft`);
const dbb=await h.req(`${PUB}/${v3id}/entries/${findV3("kb").id}/draft`);
eq("kadiv/wakadiv same 4-controller path",[da.body.data.sections.map((s:any)=>s.targetId),dbb.body.data.sections.map((s:any)=>s.targetId)],[["controller1","controller2","controller3","controller4","ketum","waketum"],["controller1","controller2","controller3","controller4","ketum","waketum"]]);
const full=(d:any,value:number=4)=>d.questions.map((q:any)=>({question_id:q.id,value:q.type==="scale"?value:'Unicode 你好, "quote"\nnext'}));
const va=full(da.body.data);
const missingVersion=await h.req(`${PUB}/${v3id}/submit-v2`,{method:"POST",json:{entry_id:findV3("ka").id,answers:va}});
eq("v3 final expected_version mandatory",missingVersion.status,422);
const saveV3=await h.req(`${PUB}/${v3id}/entries/${findV3("ka").id}/draft`,{method:"PUT",json:{expected_version:0,answers:va}});
eq("save v3",saveV3.status,200);
const staleV3=await h.req(`${PUB}/${v3id}/submit-v2`,{method:"POST",json:{entry_id:findV3("ka").id,expected_version:0,answers:va}});
eq("stale final 409",staleV3.status,409);
eq("draft conflict state",staleV3.body.errors?.state,["draft_conflict"]);
const statusA=await h.req(`/api/v1/qpr-participation/${v3id}?division=ukm`,{token:"tok-a-admin",headers:{"X-Division-Id":"ukm"}});
eq("forged division header only own status",statusA.body.data.total_entries,7);
eq("draft counted pending",statusA.body.data.done_entries,0);
const statusString=JSON.stringify(statusA.body.data);
ok("status strict projection no IDs answers targets",!["draft", "question", "score", "target", "memberKey", "member_key",findV3("ka").id,"Kadiv B"].some((x)=>statusString.includes(x)),statusA.body.data);
eq("guest status 401",(await h.req(`/api/v1/qpr-participation/${v3id}`)).status,401);
eq("no membership status 403",(await h.req(`/api/v1/qpr-participation/${v3id}`,{token:"tok-outsider"})).status,403);
await h.sql(`UPDATE cms_memberships SET status='inactive' WHERE id='m-a-viewer'`);
eq("inactive membership 403",(await h.req(`/api/v1/qpr-participation/${v3id}`,{token:"tok-a-viewer"})).status,403);
const final3=await h.req(`${PUB}/${v3id}/submit-v2`,{method:"POST",json:{entry_id:findV3("ka").id,expected_version:1,answers:va}});
eq("v3 final latest version success",final3.status,200);
const again3=await h.req(`${PUB}/${v3id}/submit-v2`,{method:"POST",json:{entry_id:findV3("ka").id,expected_version:1,answers:va}});
eq("final accepted retry distinct state",again3.body.errors?.state,["already_final"]);
const statusAfter=await h.req(`/api/v1/qpr-participation/${v3id}`,{token:"tok-a-admin"});
eq("own final changes status",statusAfter.body.data.done_entries,1);
const ownB=await h.req(`/api/v1/qpr-participation/${v3id}`,{token:"tok-b-admin"});
eq("division B isolated count",ownB.body.data.total_entries,2);
const recap3=await h.req(`${ADMIN}/periods/${v3id}/recap-v2`,{token:"tok-bph"});
eq("controller1 response from kadiv",recap3.body.data.sections.find((s:any)=>s.target_id==="controller1").questions[0].responses,1);
eq("controller2 also rated by same kadiv",recap3.body.data.sections.find((s:any)=>s.target_id==="controller2").questions[0].responses,1);
const csv3=await h.req(`${ADMIN}/periods/${v3id}/export`,{token:"tok-bph"});
ok("CSV target ID label header",csv3.body.includes('Nama sintetis controller1 | controller1-s01 | Controller'));
ok("CSV multiline quote Unicode preserved",csv3.body.includes('Unicode 你好, ""quote""\nnext'));
await h.req(`${ADMIN}/periods/${v3id}/close`,{token:"tok-bph",method:"POST"});
eq("reopen frozen valid snapshot",(await h.req(`${ADMIN}/periods/${v3id}/open`,{token:"tok-bph",method:"POST"})).status,200);

section("Deterministic database write-time guards and rollback");
const { getDb } = await import("./db/connection");
const { qprService } = await import("./modules/qpr/qpr.service");
const realDb=getDb(h.d1 as D1Database);
const rollbackEntry=findV3("rollback");
const rollbackDraft=await qprService.getDraft(realDb,v3id,rollbackEntry.id);
await qprService.saveDraft(realDb,v3id,rollbackEntry.id,{expected_version:0,answers:full(rollbackDraft)});
await h.sql(`CREATE TRIGGER qpr_test_fail BEFORE UPDATE OF done ON qpr_entries WHEN NEW.id='${rollbackEntry.id}' AND NEW.done=1 BEGIN SELECT RAISE(ABORT,'test final rollback'); END`);
let rolledBack=false;
try { await qprService.submitV2(realDb,v3id,{entry_id:rollbackEntry.id,expected_version:1,answers:full(rollbackDraft)}); } catch { rolledBack=true; }
ok("second batch statement fails",rolledBack);
const rb=await h.sql(`SELECT done,draft_answers,(SELECT count(*) FROM qpr_answers WHERE entry_id=?) AS finals FROM qpr_entries WHERE id=?`,rollbackEntry.id,rollbackEntry.id);
ok("D1 batch rollback preserves draft and no final",rb[0].done===0&&rb[0].draft_answers!==null&&rb[0].finals===0,rb);
await h.sql(`DROP TRIGGER qpr_test_fail`);
const closeEntry=findV3("close");
const closeDraft=await qprService.getDraft(realDb,v3id,closeEntry.id);
const realClient=(realDb as any).$client;
const closeBeforeWrite = new Proxy(realDb,{get(target,key){
 if(key==="$client") return {prepare:realClient.prepare.bind(realClient),batch:async(statements:any[])=>{
  await h.sql(`UPDATE qpr_periods SET status='closed' WHERE id=?`,v3id);
  return realClient.batch(statements);
 }};
 return Reflect.get(target,key);
}});
let closeError:any;
try {await qprService.submitV2(closeBeforeWrite,v3id,{entry_id:closeEntry.id,expected_version:0,answers:full(closeDraft)});}catch(e){closeError=e;}
eq("close commits between read/insert prevents final",closeError?.statusCode,404);
const closeRow=await h.sql(`SELECT done,(SELECT count(*) FROM qpr_answers WHERE entry_id=?) AS finals FROM qpr_entries WHERE id=?`,closeEntry.id,closeEntry.id);
eq("close-before-insert zero final unchanged done",[closeRow[0].done,closeRow[0].finals],[0,0]);
await qprService.setStatus(realDb,v3id,"open");
// SQL-trigger close before draft write: forces deterministic ordering, update WHERE recheck.
const closeBeforeDraft = new Proxy(realDb,{get(target,key){
 if(key==="update") return (...args:any[])=>{
  const builder=(target.update as any)(...args);
  const originalSet=builder.set.bind(builder);
  builder.set=(...setArgs:any[])=>{
   const query=originalSet(...setArgs); const originalWhere=query.where.bind(query);
   query.where=(...whereArgs:any[])=>{const filtered=originalWhere(...whereArgs); const originalReturning=filtered.returning.bind(filtered);
    filtered.returning=(...returnArgs:any[])=>{const runnable=originalReturning(...returnArgs);const then=runnable.then.bind(runnable);
     runnable.then=async(resolve:any,reject:any)=>{await h.sql(`UPDATE qpr_periods SET status='closed' WHERE id=?`,v3id);return then(resolve,reject);};return runnable;};return filtered;};return query;};return builder;};
 return Reflect.get(target,key);
}});
let saveClosed:any;
try{await qprService.saveDraft(closeBeforeDraft,v3id,closeEntry.id,{expected_version:0,answers:[]});}catch(e){saveClosed=e;}
eq("close-before-draft-write rejects",saveClosed?.statusCode,404);
eq("draft version unchanged after close-before-write",(await h.sql(`SELECT draft_version FROM qpr_entries WHERE id=?`,closeEntry.id))[0].draft_version,0);
await qprService.setStatus(realDb,v3id,"open");
const offsetEntry=findV3("offset");
const offsetDraft=await qprService.getDraft(realDb,v3id,offsetEntry.id);
await h.sql(`UPDATE qpr_periods SET opens_at='2026-10-05T23:59:59+14:00',closes_at='2026-10-05T00:00:00-12:00' WHERE id=?`,v3id);
// Use fixed-window literals around current time instead of wall-clock-specific fixture.
const nowMs=Date.now();
const offsetIso=(ms:number,hours:number)=>new Date(ms+hours*3600000).toISOString().replace('Z',`${hours>=0?'+':'-'}${String(Math.abs(hours)).padStart(2,'0')}:00`);
await h.sql(`UPDATE qpr_periods SET opens_at=?,closes_at=? WHERE id=?`,offsetIso(nowMs-60000,14),offsetIso(nowMs+60000,-12),v3id);
const offsetFinal=await qprService.submitV2(realDb,v3id,{entry_id:offsetEntry.id,expected_version:0,answers:full(offsetDraft)});
ok("SQL compares timezone dates not lexical strings",Boolean(offsetFinal.submitted_at));
await h.sql(`UPDATE qpr_periods SET opens_at=NULL,closes_at=NULL WHERE id=?`,v3id);
const badDate=await h.req(`${ADMIN}/periods/${v3id}`,{token:"tok-bph",method:"PUT",json:{opens_at:"2026-02-30T00:00:00Z"}});
eq("impossible calendar date rejected",badDate.status,422);
const incomplete3=await h.req(`${ADMIN}/periods`,{token:"tok-bph",method:"POST",json:{form_kind:"bph",title:"Incomplete v3"}});
eq("incomplete v3 draft allowed",incomplete3.status,201);
eq("incomplete v3 open blocked",(await h.req(`${ADMIN}/periods/${incomplete3.body.data.id}/open`,{token:"tok-bph",method:"POST"})).status,422);
const invalidTarget={...config,targets:config.targets.map((t)=>({...t,id:t.id==="bendum1"?"unknown":t.id}))};
eq("unknown fixed target rejected",(await h.req(`${ADMIN}/periods`,{token:"tok-bph",method:"POST",json:{form_kind:"bph",title:"Bad target",target_config:invalidTarget}})).status,422);


section("Admin publish races and large roster");
const large=await qprService.createPeriod(realDb,{form_kind:"bph",title:"Large roster",target_config:config,userId:"u-bph"});
await qprService.addEntries(realDb,large.id,Array.from({length:100},(_,i)=>({name:`Member ${i}`,role:"anggota",division_slug:"ristek",member_key:`large-${i}`})));
eq("100-member open respects D1 bind limit",(await qprService.setStatus(realDb,large.id,"open")).status,"open");
const racePeriod=await qprService.createPeriod(realDb,{form_kind:"bph",title:"Admin race",target_config:config,userId:"u-bph"});
const raceEntries=await qprService.addEntries(realDb,racePeriod.id,[{name:"Race member",role:"anggota",division_slug:"ristek",member_key:"admin-race"}]);
const interceptUpdate=(before:()=>Promise<unknown>)=>new Proxy(realDb,{get(target,key){
 if(key!=="update")return Reflect.get(target,key);
 return (...args:any[])=>{const builder=(target.update as any)(...args);const set=builder.set.bind(builder);
  builder.set=(...setArgs:any[])=>{const query=set(...setArgs);const where=query.where.bind(query);
   query.where=(...whereArgs:any[])=>{const filtered=where(...whereArgs);const returning=filtered.returning.bind(filtered);
    filtered.returning=(...returnArgs:any[])=>{const runnable=returning(...returnArgs);const then=runnable.then.bind(runnable);
     runnable.then=async(resolve:any,reject:any)=>{await before();return then(resolve,reject);};return runnable;};return filtered;};return query;};return builder;};
}});
let changedOpen:any;
try{await qprService.setStatus(interceptUpdate(()=>h.sql(`UPDATE qpr_entries SET member_role='kadiv' WHERE id=?`,raceEntries[0].id)),racePeriod.id,"open");}catch(e){changedOpen=e;}
eq("roster changed after preview blocks open",changedOpen?.statusCode,409);
eq("failed publish retains draft",(await h.sql(`SELECT status FROM qpr_periods WHERE id=?`,racePeriod.id))[0].status,"draft");
await h.sql(`UPDATE qpr_entries SET member_role='anggota' WHERE id=?`,raceEntries[0].id);
let frozenUpdate:any;
try{await qprService.updatePeriod(interceptUpdate(()=>qprService.setStatus(realDb,racePeriod.id,"open")),racePeriod.id,{target_config:config});}catch(e){frozenUpdate=e;}
eq("open commits before admin snapshot write guards conflict",frozenUpdate?.statusCode,409);
let triggerFrozen=false;
try{await h.sql(`UPDATE qpr_entries SET name='Mutated' WHERE id=?`,raceEntries[0].id);}catch{triggerFrozen=true;}
ok("DB roster identity constraint protects first-open",triggerFrozen);
let markerFrozen=false;
try{await h.sql(`UPDATE qpr_periods SET first_opened_at=NULL WHERE id=?`,racePeriod.id);}catch{markerFrozen=true;}
ok("first-open marker cannot reset",markerFrozen);


const statusList=await h.req(`/api/v1/qpr-participation`,{token:"tok-a-admin"});
ok("participation list flat metadata",statusList.body.data.some((p:any)=>p.id===v3id&&p.title==="V3 regression"&&p.period===undefined));
const legacyDupPeriod=await qprService.createPeriod(realDb,{title:"Legacy namesakes",questions:QUESTIONS,userId:"u-bph"});
await qprService.addEntries(realDb,legacyDupPeriod.id,[{name:"Legacy Same",member_key:"legacy-one"}]);
let legacyDuplicate:any;
try{await qprService.addEntries(realDb,legacyDupPeriod.id,[{name:"legacy same",member_key:"legacy-two"}]);}catch(e){legacyDuplicate=e;}
eq("legacy namesakes forbidden even stable keys",legacyDuplicate?.statusCode,409);
const casEntry=findV3("same-1");
const casDraft=await qprService.getDraft(realDb,v3id,casEntry.id);
await qprService.saveDraft(realDb,v3id,casEntry.id,{expected_version:0,answers:[]});
const advancedVersion=interceptUpdate(()=>h.sql(`UPDATE qpr_entries SET draft_version=2 WHERE id=?`,casEntry.id));
const casResult=await qprService.saveDraft(advancedVersion,v3id,casEntry.id,{expected_version:2,answers:[]});
eq("CAS increments actual matched DB version",casResult.draft_version,3);


const { resolveSnapshotPath }=await import("./modules/qpr/qpr.templates");
eq("historical v2 ketum path retained",resolveSnapshotPath({version:2,sections:buildBphSections()},{memberRole:"ketum",divisionSlug:null}).map((s)=>s.targetId),["ketum","waketum"]);
await qprService.setStatus(realDb,legacyDupPeriod.id,"open");
let incompleteLegacy:any;
try{await qprService.submitPublic(realDb,legacyDupPeriod.id,{name:"Legacy Same",answers:[{...QUESTIONS[0],score:4}]});}catch(e){incompleteLegacy=e;}
eq("legacy final incomplete rejected",incompleteLegacy?.statusCode,422);
let duplicateLegacy:any;
try{await qprService.submitPublic(realDb,legacyDupPeriod.id,{name:"Legacy Same",answers:[{...QUESTIONS[0],score:4},{...QUESTIONS[0],score:5}]});}catch(e){duplicateLegacy=e;}
eq("legacy final duplicate rejected",duplicateLegacy?.statusCode,422);
// Superset recap/export query uses one JSON binding, not one per entry.
const largeRows=await h.sql(`SELECT id FROM qpr_entries WHERE period_id=?`,large.id);
for(const e of largeRows){
 await h.sql(`UPDATE qpr_entries SET done=1 WHERE id=?`,e.id);
 await h.sql(`INSERT INTO qpr_answers(id,entry_id,answers,submitted_at) VALUES (?,?,?,?)`,`answer-${e.id}`,e.id,JSON.stringify(full(offsetDraft)),new Date().toISOString());
}
eq("100-final recap avoids D1 bind ceiling",(await qprService.recapV2(realDb,large.id)).done_entries,100);
ok("100-final CSV avoids D1 bind ceiling",(await qprService.exportCsv(realDb,large.id)).csv.includes("Member 99"));

console.log(`\n${passed} passed, ${failed} failed`);
// Miniflare/workerd menahan event loop setelah dispose() — exit eksplisit.
process.exit(failed ? 1 : 0);
