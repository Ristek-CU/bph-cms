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

// Draft → publik informasi saja (jadwal), tanpa roster/pertanyaan
const draftPublic = await h.req(`${PUB}/${pid}`);
eq("draft → publik info tanpa roster", [draftPublic.status, draftPublic.body?.data?.isOpen, draftPublic.body?.data?.remaining, draftPublic.body?.data?.questions], [200, false, [], null]);

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
eq("periode tutup → publik info tanpa roster", [closedRoster.status, closedRoster.body?.data?.isOpen, closedRoster.body?.data?.remaining, closedRoster.body?.data?.questions], [200, false, [], null]);
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
// Kontrak anonim: rekap tidak boleh mengekspos pemetaan jawaban → orang.
ok("rekap tanpa daftar responden", rv2.body?.data?.respondents === undefined, Object.keys(rv2.body?.data ?? {}));
const rRecapJson = JSON.stringify(rv2.body?.data ?? {});
ok("rekap tidak memuat nama pengisi final", !["R1", "R2", "R3"].some((n) => rRecapJson.includes(`"${n}"`)), rRecapJson.slice(0, 400));
ok("pending tetap berisi nama yang belum mengisi", rv2.body?.data?.pending?.length === 2, rv2.body?.data?.pending);
const rSection = rv2.body?.data?.sections?.find((s: any) => s.target_id === "ketum");
const rQ = rSection?.questions?.find((q: any) => q.id === firstScale.id);
ok("distribusi 1/4/5 masing-masing 1", rQ?.distribution?.filter((d: any) => d.count > 0).length === 3 && rQ.distribution.every((d: any) => [1, 4, 5].includes(d.value) ? d.count === 1 : d.count === 0), rQ?.distribution);
eq("mean 3.33", rQ?.mean, 3.33);
eq("denominator 3 (bukan 4 — draft tidak dihitung)", rQ?.responses, 3);
// Poin = akumulasi nilai skala 1–5 pada jalur responden; teks tidak menyumbang.
const rScaleCount = rQuestions.filter((q: any) => q.type === "scale").length;
ok("agregat poin anonim (mean/max/min dari 3 respons)", rv2.body?.data?.score_total?.responses === 3
	&& rv2.body?.data?.score_total?.mean === Math.round(rScaleCount * ((1 + 4 + 5) / 3) * 100) / 100
	&& rv2.body?.data?.score_total?.max === rScaleCount * 5
	&& rv2.body?.data?.score_total?.min === rScaleCount * 1, rv2.body?.data?.score_total);
const rText = rSection?.questions?.find((q: any) => q.type === "text");
ok("teks terkumpul 3", rText?.texts?.length === 3, rText?.texts);
ok("rekap teks tanpa identitas pengisi", rText?.text_responses === undefined, rText && Object.keys(rText));

// Legacy periode → recap-v2 menolak (arahkan ke recap lama)
const legacyRecap = await h.req(`${ADMIN}/periods/legacy-periode-1/recap-v2`, { token: "tok-bph" });
eq("recap-v2 periode legacy → 422", legacyRecap.status, 422);

const csvRes = await h.req(`${ADMIN}/periods/${rPid}/export`, { token: "tok-bph" });
eq("export → 200", csvRes.status, 200);
const csvText = typeof csvRes.body === "string" ? csvRes.body : "";
ok("CSV 3 baris data + header", csvText.split("\r\n").length === 4, csvText.split("\r\n").length);
	ok("kolom header pakai question_id unik", csvText.replace(/^\ufeff/, "").startsWith("\"waktu_kirim\"") && csvText.includes(firstScale.id));
ok("hanya 3 baris final (draft tidak diekspor)", !csvText.includes("R4 Draft"));
// Anonim: tanpa kolom identitas, dan tidak ada nama pengisi di seluruh isi CSV.
const csvHeader = csvText.replace(/^\ufeff/, "").split("\r\n")[0];
ok("CSV tanpa kolom nama/divisi/jabatan/role", !/"(nama|divisi|jabatan|role)"/.test(csvHeader), csvHeader);
ok("CSV tanpa nama pengisi", !["R1", "R2", "R3"].some((n) => csvText.includes(`"${n}"`)), csvText);

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
// ID stabil tanpa member_key ditulis admin: impor ulang nama sama = entry sama.
const keyless1 = await h.req(`${ADMIN}/periods/${v3id}/entries`, {token:"tok-bph",method:"POST",json:{entries:[{name:"Tanpa Kunci",role:"anggota",division_slug:"ristek"}]}});
eq("v3 keyless import accepted",keyless1.status,201);
const keylessRole = await h.req(`${ADMIN}/periods/${v3id}/entries`, {token:"tok-bph",method:"POST",json:{entries:[{name:"Tanpa Kunci",role:"kadiv",division_slug:"ristek"}]}});
eq("v3 keyless role change keeps id",[keylessRole.status,keylessRole.body.data[0]?.id],[201,keyless1.body.data[0].id]);
eq("v3 keyless role change applied",keylessRole.body.data[0]?.memberRole,"kadiv");
const badRoleMissing = await h.req(`${ADMIN}/periods/${v3id}/entries`, {token:"tok-bph",method:"POST",json:{entries:[{name:"Tanpa Jabatan",division_slug:"ristek"}]}});
eq("v3 role still required",badRoleMissing.status,422);
// Baris uji di atas sementara — kembalikan roster ke bentuk awal supaya hitungan
// partisipasi periode ini tidak bergeser.
eq("v3 keyless row cleaned up",(await h.req(`${ADMIN}/periods/${v3id}/entries/${keyless1.body.data[0].id}`,{token:"tok-bph",method:"DELETE"})).status,200);
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
// T10: retry setelah timeout harus membawa bukti kirim (waktu submit) di 409.
ok("already_final 409 carries submitted_at proof",typeof again3.body.errors?.submitted_at === "string" && !Number.isNaN(Date.parse(again3.body.errors.submitted_at)),again3.body.errors);
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
// Invarian anonim di level DB: jawaban final tidak punya jalur ke nama pengisi.
const respSchema=await h.sql(`PRAGMA table_info(qpr_responses)`);
ok("qpr_responses tanpa kolom entry_id/nama",!respSchema.some((c:any)=>["entry_id","name","member_key","member_id"].includes(c.name)),respSchema.map((c:any)=>c.name));
const resp3=await h.sql(`SELECT id,period_id,role,division_slug,score_total FROM qpr_responses WHERE period_id=?`,v3id);
eq("satu respons anonim tersimpan",resp3.length,1);
ok("respons anonim tidak menyimpan nama",!JSON.stringify(resp3).includes("Kadiv A"),resp3);
const answer3=await h.sql(`SELECT answers FROM qpr_answers a JOIN qpr_entries e ON e.id=a.entry_id WHERE e.id=?`,findV3("ka").id);
eq("qpr_answers periode snapshot hanya baris penanda",JSON.parse(answer3[0].answers),[]);
const csv3NoName=!["Kadiv A","Kadiv B","Bendiv","Sekdiv"].some((n)=>csv3.body.includes(n));
ok("CSV v3 tanpa nama pengisi",csv3NoName,csv3.body.slice(0,300));
await h.req(`${ADMIN}/periods/${v3id}/close`,{token:"tok-bph",method:"POST"});
eq("reopen frozen valid snapshot",(await h.req(`${ADMIN}/periods/${v3id}/open`,{token:"tok-bph",method:"POST"})).status,200);

section("Deterministic database write-time guards and rollback");
const { getDb } = await import("./db/connection");
const { qprService, effectiveStatus } = await import("./modules/qpr/qpr.service");
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
// Anonim: 100 final disimulasikan di qpr_responses (tanpa entry_id), sama
// seperti hasil submit sebenarnya untuk periode snapshot.
const largeRows=await h.sql(`SELECT id FROM qpr_entries WHERE period_id=?`,large.id);
for(const e of largeRows){
 await h.sql(`UPDATE qpr_entries SET done=1, submitted_at=? WHERE id=?`,new Date().toISOString(),e.id);
 await h.sql(`INSERT INTO qpr_responses(id,period_id,role,division_slug,answers,score_total,submitted_at) VALUES (?,?,?,?,?,?,?)`,
  `response-${e.id}`,large.id,"anggota","ristek",JSON.stringify(full(offsetDraft).map((a:any)=>({question_id:a.question_id,value:a.value}))),0,new Date().toISOString());
}
eq("100-final recap avoids D1 bind ceiling",(await qprService.recapV2(realDb,large.id)).done_entries,100);
const largeCsv=(await qprService.exportCsv(realDb,large.id)).csv;
ok("100-final CSV avoids D1 bind ceiling",largeCsv.split("\r\n").length===101,largeCsv.split("\r\n").length);
ok("CSV anonim: tanpa nama pengisi",!largeCsv.includes("Member 99")&&!/\bMember \d+\b/.test(largeCsv));

section("Full v3 questionnaire mutation");
const editable = await qprService.createPeriod(realDb, { form_kind: "bph", title: "Editable v3", target_config: config, userId: "u-bph" });
const editUrl = `${ADMIN}/periods/${editable.id}`;
const edit = (json: unknown) => h.req(editUrl, { token: "tok-bph", method: "PUT", json });
const baseline = editable.questions as any;
const sections = structuredClone(baseline.sections);
sections[0].title = "Custom section";
sections[0].questions = [
 { id: "custom-text", type: "text", label: "Optional custom text", required: false },
 { ...sections[0].questions[0], type: "text", label: "Changed type", required: false },
];
sections.reverse();
eq("full sections require baseline", (await edit({ sections })).status, 422);
eq("baseline must object", (await edit({ sections, expected_snapshot: JSON.stringify(baseline) })).status, 422);
eq("baseline without sections rejected", (await edit({ expected_snapshot: baseline })).status, 422);
eq("sections plus label patch ambiguous", (await edit({ sections, expected_snapshot: baseline, question_labels: {} })).status, 422);
eq("sections plus legacy questions ambiguous", (await edit({ sections, expected_snapshot: baseline, questions: QUESTIONS })).status, 422);
eq("client routing rejected", (await edit({ routing: { anggota: [] } })).status, 422);
const edited = await edit({ sections, expected_snapshot: baseline });
eq("full structure edit accepted", edited.status, 200);
const sectionValues = (items: any[]) => items.map(s => [s.id, s.title, s.targetId, s.targetLabel, s.questions]);
eq("order title type required add delete retained", sectionValues(edited.body.data.questions.sections), sectionValues(sections));
eq("full edit routing server-owned", edited.body.data.questions.routing, baseline.routing);
eq("stale baseline rejected", (await edit({ sections: baseline.sections, expected_snapshot: baseline })).status, 409);
let current = edited.body.data.questions;
const invalidSections = async (label: string, mutate: (s: any[]) => void) => {
 const s = structuredClone(current.sections); mutate(s);
 eq(label, (await edit({ sections: s, expected_snapshot: current })).status, 422);
};
await invalidSections("duplicate question across sections rejected", s => { s[0].questions[0].id = s[1].questions[0].id; });
await invalidSections("section/question ID collision rejected", s => { s[0].questions[0].id = s[1].id; });
await invalidSections("duplicate section IDs rejected", s => { s[0].id = s[1].id; });
await invalidSections("duplicate targets rejected", s => { s[0].targetId = s[1].targetId; });
await invalidSections("missing target section rejected", s => { s.pop(); });
await invalidSections("unknown target rejected", s => { s[0].targetId = "unknown"; });
await invalidSections("empty section rejected", s => { s[0].questions = []; });
await invalidSections("blank title rejected", s => { s[0].title = " \n "; });
await invalidSections("blank label rejected", s => { s[0].questions[0].label = " \t "; });
await invalidSections("whitespace ID rejected", s => { s[0].questions[0].id = " id "; });
const renamedConfig = structuredClone(config);
renamedConfig.targets[0].label = "Renamed target";
const configOnly = await edit({ target_config: renamedConfig });
eq("config-only preserves custom questions", configOnly.body.data.questions.sections.find((s: any) => s.targetId === "controller1").questions, sections.find((s: any) => s.targetId === "controller1").questions);
eq("config-only preserves custom title", configOnly.body.data.questions.sections.find((s: any) => s.targetId === "controller1").title, "Custom section");
eq("config-only preserves custom section ordering", configOnly.body.data.questions.sections.map((s: any) => s.id), sections.map((s: any) => s.id));
current = configOnly.body.data.questions;
const patched = await edit({ question_labels: { "custom-text": " Patched label " } });
eq("legacy label patch compatible", patched.status, 200);
eq("label patch trims", patched.body.data.questions.sections.find((s: any) => s.targetId === "controller1").questions[0].label, "Patched label");
eq("blank label patch rejected", (await edit({ question_labels: { "custom-text": "   " } })).status, 422);
eq("unknown label ID rejected", (await edit({ question_labels: { unknown: "Text" } })).status, 422);
current = patched.body.data.questions;
const filledSections = structuredClone(current.sections);
for (const s of filledSections) s.questions = Array.from({ length: ["ketum", "waketum"].includes(s.targetId) ? 50 : 100 }, (_, i) => ({ id: `${s.targetId}-new-${i}`, type: "scale", label: `Question ${i}`, required: false }));
const atLimit = await edit({ sections: filledSections, expected_snapshot: current });
eq("exact 500-question kadiv path accepted without roster", atLimit.status, 200);
current = atLimit.body.data.questions;
await invalidSections("501 questions rejected even role absent roster", s => { s.find(x => x.targetId === "ketum").questions.push({ id: "over-limit", type: "text", label: "Too many", required: false }); });
const optionalSections = current.sections.map((s: any) => ({ ...s, questions: [{ id: `${s.targetId}-optional`, type: "text", label: "Optional", required: false }] }));
const optional = await edit({ sections: optionalSections, expected_snapshot: current, target_config: config });
eq("sections and config combined accepted", optional.status, 200);
current = optional.body.data.questions;
const reorderedBaseline = Object.fromEntries(Object.entries(current).reverse());
eq("baseline object key ordering irrelevant", (await edit({ sections: current.sections, expected_snapshot: reorderedBaseline })).status, 200);
let concurrentError: any;
try {
 await qprService.updatePeriod(interceptUpdate(() => qprService.updatePeriod(realDb, editable.id, { question_labels: { "ketum-optional": "Concurrent winner" } })), editable.id, { question_labels: { "waketum-optional": "Lost writer" } });
} catch (error) { concurrentError = error; }
eq("stored questions CAS rejects overlapping writes", concurrentError?.statusCode, 409);
const afterRace = await qprService.getPeriod(realDb, editable.id);
eq("winning snapshot not overwritten", (afterRace.questions as any).sections.find((s: any) => s.targetId === "ketum").questions[0].label, "Concurrent winner");
const optionalEntries = await qprService.addEntries(realDb, editable.id, [{ name: "Optional respondent", member_key: "optional-one", division_slug: "ristek", role: "anggota" }]);
const optionalPreview = await qprService.preview(realDb, editable.id);
eq("preview includes shared scale legend", optionalPreview.scale_legend, (await qprService.getDraft(realDb, v3id, findV3("same-2").id)).scale_legend);
await qprService.setStatus(realDb, editable.id, "open");
eq("optional-only empty final accepted", (await h.req(`${PUB}/${editable.id}/submit-v2`, { method: "POST", json: { entry_id: optionalEntries[0].id, expected_version: 0, answers: [] } })).status, 200);
eq("required path empty final still rejected", (await h.req(`${PUB}/${v3id}/submit-v2`, { method: "POST", json: { entry_id: findV3("same-2").id, expected_version: 0, answers: [] } })).status, 422);
await qprService.setStatus(realDb, editable.id, "draft");
eq("first-open lock survives draft status", (await edit({ sections: (afterRace.questions as any).sections, expected_snapshot: afterRace.questions })).status, 409);
eq("historical v2 structure mutation rejected", (await h.req(`${ADMIN}/periods/${bphPid}`, { token: "tok-bph", method: "PUT", json: { sections, expected_snapshot: baseline } })).status, 409);

const historical = await qprService.createPeriod(realDb, { form_kind: "bph", title: "Historical v3 routing", target_config: config, userId: "u-bph" });
const historicalSnapshot = structuredClone(historical.questions) as any;
historicalSnapshot.routing.kadiv = ["$controller", "ketum", "waketum"];
historicalSnapshot.routing.wakadiv = ["$controller", "ketum", "waketum"];
historicalSnapshot.target_config.controller_by_division = { ristek: "controller2" };
await h.sql("UPDATE qpr_periods SET questions=? WHERE id=?", JSON.stringify(historicalSnapshot), historical.id);
const historicalConfig = structuredClone(historicalSnapshot.target_config);
historicalConfig.targets[0].label = "Historical renamed";
const historicalUpdated = await qprService.updatePeriod(realDb, historical.id, { target_config: historicalConfig });
eq("historical v3 mapping route survives config edit", (historicalUpdated.questions as any).routing, historicalSnapshot.routing);
eq("historical v3 resolver still one mapped controller", resolveSnapshotPath(historicalUpdated.questions as any, { memberRole: "kadiv", divisionSlug: "ristek" }).map(s => s.targetId), ["controller2", "ketum", "waketum"]);
const freshV2 = await qprService.createPeriod(realDb, { form_kind: "bph", title: "Unopened v2 compatibility", userId: "u-bph" });
await h.sql("UPDATE qpr_periods SET questions=? WHERE id=?", JSON.stringify({ version: 2, sections: buildBphSections() }), freshV2.id);
eq("unopened v2 rejects full sections", (await h.req(`${ADMIN}/periods/${freshV2.id}`, { token: "tok-bph", method: "PUT", json: { sections, expected_snapshot: baseline } })).status, 422);
eq("empty target config rejected", (await h.req(`${ADMIN}/periods`, { token: "tok-bph", method: "POST", json: { form_kind: "bph", title: "Empty targets", target_config: { targets: [], controller_by_division: {} } } })).status, 422);

const legacyPreview = await qprService.preview(realDb, legacyDupPeriod.id);
eq("legacy preview renders question labels/categories", legacyPreview.entries[0].sections[0].questions, QUESTIONS.map((q, i) => ({ id: `legacy-${i}`, type: "scale", label: q.label, category: q.category, required: true })));
eq("legacy preview required count matches questions", legacyPreview.entries[0].required, QUESTIONS.length);

section("Legacy question pair identity");
const duplicatePairs = [QUESTIONS[0], QUESTIONS[0]];
eq("legacy create duplicate pair rejected", (await h.req(`${ADMIN}/periods`, { token: "tok-bph", method: "POST", json: { title: "Duplicate legacy pairs", questions: duplicatePairs } })).status, 422);
const pairQuestions = [QUESTIONS[0], { ...QUESTIONS[0], category: "Other category" }];
const pairPeriod = await qprService.createPeriod(realDb, { title: "Distinct legacy pairs", questions: pairQuestions, userId: "u-bph" });
eq("legacy update duplicate pair rejected", (await h.req(`${ADMIN}/periods/${pairPeriod.id}`, { token: "tok-bph", method: "PUT", json: { questions: duplicatePairs } })).status, 422);
let duplicateCreate: any;
try { await qprService.createPeriod(realDb, { title: "Direct duplicate pairs", questions: duplicatePairs, userId: "u-bph" }); } catch (error) { duplicateCreate = error; }
eq("direct create duplicate pair rejected", duplicateCreate?.statusCode, 422);
let duplicateUpdate: any;
try { await qprService.updatePeriod(realDb, pairPeriod.id, { questions: duplicatePairs }); } catch (error) { duplicateUpdate = error; }
eq("direct update duplicate pair rejected", duplicateUpdate?.statusCode, 422);
await qprService.addEntries(realDb, pairPeriod.id, [{ name: "Pair respondent" }]);
await qprService.setStatus(realDb, pairPeriod.id, "open");
eq("same label different categories submit succeeds", (await h.req(`${PUB}/${pairPeriod.id}/submit`, { method: "POST", json: { name: "Pair respondent", answers: pairQuestions.map(q => ({ ...q, score: 4 })) } })).status, 200);

// ── QPR v4: rubrik 360° (kategori + routing dari roster) ────────────────────
section("QPR v4 rubrik 360°");
const TOPIC_CATEGORIES = [
	{ title: "Kepemimpinan", scope: "all", questions: [{ type: "scale", label: "Memberi arahan yang jelas", required: true }] },
	{ title: "Komunikasi", scope: "all", questions: [{ type: "scale", label: "Mudah diajak berdiskusi", required: true }] },
	{ title: "Kedisiplinan", scope: "positions", questions: [{ type: "text", label: "Satu hal yang perlu diperbaiki", required: true }] },
];
const v4 = await h.req(`${ADMIN}/periods`, { token: "tok-bph", method: "POST", json: { form_kind: "division", title: "QPR 360 Oktober 2026", categories: TOPIC_CATEGORIES } });
eq("v4 create with categories", v4.status, 201);
const v4id = v4.body.data.id;
eq("v4 snapshot version", v4.body.data.questions.version, 4);
eq("v4 category questions kept", v4.body.data.questions.categories.map((c: any) => [c.title, c.scope, c.questions.length]), [["Kepemimpinan", "all", 1], ["Komunikasi", "all", 1], ["Kedisiplinan", "positions", 1]]);
eq("v4 create without categories rejected", (await h.req(`${ADMIN}/periods`, { token: "tok-bph", method: "POST", json: { form_kind: "division", title: "Tanpa kategori" } })).status, 422);

// Roster: president, VP, 2 controller (satu mengurus 2 divisi), sekum, bendum,
// kadiv/wakadiv/sekdiv/bendiv/anggota ristek, anggota ukm.
const rosterItems = [
	{ name: "Presiden Satu", role: "president" },
	{ name: "Wapres Satu", role: "vice_president" },
	{ name: "Controller Ristek UKM", role: "controller", division_slug: "ristek", manages: ["ristek", "ukm"] },
	{ name: "Controller Media", role: "controller", division_slug: "media", manages: ["media"] },
	{ name: "Sekum Satu", role: "sekum", division_slug: "bph" },
	{ name: "Bendum Satu", role: "bendum", division_slug: "bph" },
	{ name: "Kadiv Ristek", role: "kadiv", division_slug: "ristek" },
	{ name: "Wakadiv Ristek", role: "wakadiv", division_slug: "ristek" },
	{ name: "Sekdiv Ristek", role: "sekdiv", division_slug: "ristek" },
	{ name: "Bendiv Ristek", role: "bendiv", division_slug: "ristek" },
	{ name: "Anggota Ristek", role: "anggota", division_slug: "ristek" },
	{ name: "Anggota UKM", role: "anggota", division_slug: "ukm" },
];
eq("v4 controller without manages rejected", (await h.req(`${ADMIN}/periods/${v4id}/entries`, { token: "tok-bph", method: "POST", json: { entries: [{ name: "Controller Tanpa Divisi", role: "controller", division_slug: "ristek" }] } })).status, 422);
eq("v4 manages only for controller", (await h.req(`${ADMIN}/periods/${v4id}/entries`, { token: "tok-bph", method: "POST", json: { entries: [{ name: "Kadiv Salah", role: "kadiv", division_slug: "ristek", manages: ["ukm"] }] } })).status, 422);
eq("v4 non-leader needs division", (await h.req(`${ADMIN}/periods/${v4id}/entries`, { token: "tok-bph", method: "POST", json: { entries: [{ name: "Tanpa Divisi", role: "kadiv" }] } })).status, 422);
const v4rows = await h.req(`${ADMIN}/periods/${v4id}/entries`, { token: "tok-bph", method: "POST", json: { entries: rosterItems } });
eq("v4 roster accepted", v4rows.status, 201);
const v4entry = (name: string) => v4rows.body.data.find((e: any) => e.name === name);
eq("v4 controller manages persisted", JSON.parse(v4entry("Controller Ristek UKM").managedDivisions), ["ristek", "ukm"]);

const v4preview = await h.req(`${ADMIN}/periods/${v4id}/preview`, { token: "tok-bph" });
eq("v4 preview no blockers", v4preview.body.data.blockers, []);
const targetsOf = (name: string) => v4preview.body.data.entries.find((e: any) => e.name === name).targets.map((id: string) => v4rows.body.data.find((e: any) => e.id === id).name).sort();
eq("president assesses executive board", targetsOf("Presiden Satu"), ["Bendum Satu", "Controller Media", "Controller Ristek UKM", "Sekum Satu"]);
eq("vp assesses executive board", targetsOf("Wapres Satu"), ["Bendum Satu", "Controller Media", "Controller Ristek UKM", "Sekum Satu"]);
eq("controller assesses leaders + heads it manages", targetsOf("Controller Ristek UKM"), ["Kadiv Ristek", "Presiden Satu", "Wakadiv Ristek", "Wapres Satu"]);
eq("controller media only assesses leaders", targetsOf("Controller Media"), ["Presiden Satu", "Wapres Satu"]);
eq("sekum assesses all sekdiv", targetsOf("Sekum Satu"), ["Presiden Satu", "Sekdiv Ristek", "Wapres Satu"]);
eq("bendum assesses all bendiv", targetsOf("Bendum Satu"), ["Bendiv Ristek", "Presiden Satu", "Wapres Satu"]);
eq("sekdiv assesses sekum + own division heads", targetsOf("Sekdiv Ristek"), ["Kadiv Ristek", "Presiden Satu", "Sekum Satu", "Wakadiv Ristek", "Wapres Satu"]);
eq("bendiv assesses bendum + own division heads", targetsOf("Bendiv Ristek"), ["Bendum Satu", "Kadiv Ristek", "Presiden Satu", "Wakadiv Ristek", "Wapres Satu"]);
eq("kadiv assesses members incl. sekdiv/bendiv + leaders + managing controller", targetsOf("Kadiv Ristek"), ["Anggota Ristek", "Bendiv Ristek", "Controller Ristek UKM", "Presiden Satu", "Sekdiv Ristek", "Wapres Satu"]);
eq("anggota assesses leaders + its division heads", targetsOf("Anggota UKM"), ["Presiden Satu", "Wapres Satu"]);
eq("self assessment never included", v4preview.body.data.entries.every((e: any) => !e.targets.includes(e.id)), true);
const v4required = (name: string) => v4preview.body.data.entries.find((e: any) => e.name === name).required;
eq("v4 positions category skipped for member targets", [v4required("Anggota Ristek"), v4required("Kadiv Ristek")], [12, 17]);
eq("v4 member path groups questions by category", v4preview.body.data.entries.find((e: any) => e.name === "Kadiv Ristek").sections.find((s: any) => s.targetLabel === "Anggota Ristek").questions.map((q: any) => q.category), ["Kepemimpinan", "Komunikasi"]);

eq("v4 open", (await h.req(`${ADMIN}/periods/${v4id}/open`, { token: "tok-bph", method: "POST" })).status, 200);
eq("v4 roster frozen after open", (await h.req(`${ADMIN}/periods/${v4id}/entries`, { token: "tok-bph", method: "POST", json: { entries: rosterItems } })).status, 409);
eq("v4 snapshot frozen after open", (await h.req(`${ADMIN}/periods/${v4id}`, { token: "tok-bph", method: "PUT", json: { categories: v4.body.data.questions.categories, expected_snapshot: v4.body.data.questions } })).status, 409);

const memberDraft = (await h.req(`${PUB}/${v4id}/entries/${v4entry("Anggota Ristek").id}/draft`)).body.data;
eq("v4 member final accepted", (await h.req(`${PUB}/${v4id}/submit-v2`, { method: "POST", json: { entry_id: v4entry("Anggota Ristek").id, expected_version: 0, answers: full(memberDraft) } })).status, 200);
const v4resp = await h.sql(`SELECT role, division_slug, target_ids, score_total, answers FROM qpr_responses WHERE period_id=?`, v4id);
eq("v4 response stored anonymously", { role: v4resp[0].role, division: v4resp[0].division_slug, score: v4resp[0].score_total }, { role: "anggota", division: "ristek", score: 32 });
ok("v4 response names no respondent", !String(v4resp[0].answers).includes("Anggota Ristek") && !String(v4resp[0].answers).includes(v4entry("Anggota Ristek").id));
eq("v4 target_ids maps assessed people", (JSON.parse(v4resp[0].target_ids) as string[]).map((id) => v4rows.body.data.find((e: any) => e.id === id).name).sort(), ["Kadiv Ristek", "Presiden Satu", "Wakadiv Ristek", "Wapres Satu"]);

const v4recap = await h.req(`${ADMIN}/periods/${v4id}/recap-v2`, { token: "tok-bph" });
eq("v4 recap lists every assessable person", v4recap.body.data.sections.length, rosterItems.length);
const kadivRecap = v4recap.body.data.sections.find((s: any) => s.target_label === "Kadiv Ristek");
eq("v4 recap aggregates per target", kadivRecap.questions.filter((q: any) => q.type === "scale").map((q: any) => [q.category, q.responses, q.mean]), [["Kepemimpinan", 1, 4], ["Komunikasi", 1, 4]]);
const presidentRecap = v4recap.body.data.sections.find((s: any) => s.target_label === "Presiden Satu");
eq("v4 recap top-level target includes member scores", presidentRecap.questions.map((q: any) => [q.category, q.responses]), [["Kepemimpinan", 1], ["Komunikasi", 1], ["Kedisiplinan", 1]]);
const v4csv = await h.req(`${ADMIN}/periods/${v4id}/export`, { token: "tok-bph" });
const v4csvText = typeof v4csv.body === "string" ? v4csv.body : "";
ok("v4 export header names assessee", v4csvText.includes("Kadiv Ristek") && v4csvText.split("\r\n").length === 2);
ok("v4 export includes per-target question ids", v4csvText.includes(`${v4entry("Kadiv Ristek").id}~cat-1-q1`));

// Blocker: roster tanpa president tidak boleh dibuka.
const noLeader = await h.req(`${ADMIN}/periods`, { token: "tok-bph", method: "POST", json: { form_kind: "division", title: "QPR tanpa presiden", categories: TOPIC_CATEGORIES } });
const noLeaderId = noLeader.body.data.id;
await h.req(`${ADMIN}/periods/${noLeaderId}/entries`, { token: "tok-bph", method: "POST", json: { entries: [{ name: "Kadiv Tanpa Presiden", role: "kadiv", division_slug: "ristek" }] } });
const noLeaderPreview = await h.req(`${ADMIN}/periods/${noLeaderId}/preview`, { token: "tok-bph" });
ok("v4 blocker: missing president", noLeaderPreview.body.data.blockers.some((b: string) => b.includes("President")));
ok("v4 blocker: no person actually assessable", noLeaderPreview.body.data.blockers.some((b: string) => b.includes("belum ada target")));
eq("v4 open blocked by roster blockers", (await h.req(`${ADMIN}/periods/${noLeaderId}/open`, { token: "tok-bph", method: "POST" })).status, 422);

// Editor kategori: ganti seluruh daftar kategori sebelum dibuka.
const editableV4 = await h.req(`${ADMIN}/periods`, { token: "tok-bph", method: "POST", json: { form_kind: "division", title: "QPR editor kategori", categories: TOPIC_CATEGORIES } });
const editableV4Id = editableV4.body.data.id;
const editedCategories = [
	{ id: "cat-1", title: "Visi", scope: "all", questions: [{ id: "cat-1-q1", type: "scale", label: "Visi jelas?", required: true }] },
	{ id: "cat-2", title: "Etika", scope: "positions", questions: [
		{ id: "cat-2-q1", type: "text", label: "Contoh etika baik?", required: true },
		{ id: "cat-2-q2", type: "text", label: "Perbaikan etika?", required: false },
	] },
];
const editV4 = await h.req(`${ADMIN}/periods/${editableV4Id}`, { token: "tok-bph", method: "PUT", json: { categories: editedCategories, expected_snapshot: editableV4.body.data.questions } });
eq("v4 category edit accepted", editV4.status, 200);
eq("v4 category edit replaces list", editV4.body.data.questions.categories.map((c: any) => [c.title, c.scope, c.questions.length]), [["Visi", "all", 1], ["Etika", "positions", 2]]);
eq("v4 stale category baseline rejected", (await h.req(`${ADMIN}/periods/${editableV4Id}`, { token: "tok-bph", method: "PUT", json: { categories: editedCategories, expected_snapshot: editableV4.body.data.questions } })).status, 409);
eq("v4 category edit needs baseline", (await h.req(`${ADMIN}/periods/${editableV4Id}`, { token: "tok-bph", method: "PUT", json: { categories: editedCategories } })).status, 422);
eq("v4 categories cannot mix with target_config", (await h.req(`${ADMIN}/periods/${editableV4Id}`, { token: "tok-bph", method: "PUT", json: { categories: editedCategories, expected_snapshot: editV4.body.data.questions, target_config: config } })).status, 422);
eq("v4 empty category title rejected", (await h.req(`${ADMIN}/periods/${editableV4Id}`, { token: "tok-bph", method: "PUT", json: { categories: [{ title: "  ", scope: "all", questions: [] }], expected_snapshot: editV4.body.data.questions } })).status, 422);

// ── QPR v5: matriks penilai × target ────────────────────────────────────────
section("QPR v5 matriks penilai × target");
// Pasangan yang mungkin = irisan routing v4 dengan roster yang sama.
const v4roleById = new Map(v4rows.body.data.map((e: any) => [e.id, e.memberRole]));
const feasiblePairs = [...new Map(v4preview.body.data.entries.flatMap((e: any) => e.targets.map((id: string) => ({ assessor: e.role, target: v4roleById.get(id) }))).filter((p: any) => p.assessor && p.target).map((p: any) => [`${p.assessor}>${p.target}`, p])).values()];
ok("v5 feasible pairs derived from routing", feasiblePairs.length > 5 && feasiblePairs.some((p: any) => p.assessor === "sekum" && p.target === "sekdiv") && feasiblePairs.some((p: any) => p.assessor === "bendum" && p.target === "bendiv"));
const V5_INSTRUMENTS = [
	{ title: "Penilaian umum", applies: feasiblePairs, questions: [{ type: "scale", label: "Seberapa baik orang ini menjalankan perannya?", required: true }] },
	{ title: "Umpan balik anggota", applies: feasiblePairs.filter((p: any) => p.assessor === "anggota"), questions: [{ type: "text", label: "Apa saran untuk atasan divisimu?", required: true }] },
];
const v5 = await h.req(`${ADMIN}/periods`, { token: "tok-bph", method: "POST", json: { form_kind: "division", title: "QPR matriks 360", instruments: V5_INSTRUMENTS } });
eq("v5 create with instruments", v5.status, 201);
const v5id = v5.body.data.id;
eq("v5 snapshot version", v5.body.data.questions.version, 5);
eq("v5 instrument/question ids generated", v5.body.data.questions.instruments.map((i: any) => [i.id, i.questions.map((q: any) => q.id)]), [["inst-1", ["inst-1-q1"]], ["inst-2", ["inst-2-q1"]]]);
eq("v5 empty instruments allowed for draft", (await h.req(`${ADMIN}/periods`, { token: "tok-bph", method: "POST", json: { form_kind: "division", title: "QPR matriks kosong", instruments: [] } })).status, 201);
const v5rows = await h.req(`${ADMIN}/periods/${v5id}/entries`, { token: "tok-bph", method: "POST", json: { entries: rosterItems } });
eq("v5 roster accepted", v5rows.status, 201);
const v5entry = (name: string) => v5rows.body.data.find((e: any) => e.name === name);
const v5preview = await h.req(`${ADMIN}/periods/${v5id}/preview`, { token: "tok-bph" });
eq("v5 preview no blockers when every pair covered", v5preview.body.data.blockers, []);
const v5section = (viewer: string, target: string) => v5preview.body.data.entries.find((e: any) => e.name === viewer).sections.find((s: any) => s.targetLabel === target);
eq("v5 routing unchanged: controller manages heads", v5preview.body.data.entries.find((e: any) => e.name === "Controller Ristek UKM").targets.map((id: string) => v5rows.body.data.find((e: any) => e.id === id).name).sort(), ["Kadiv Ristek", "Presiden Satu", "Wakadiv Ristek", "Wapres Satu"]);
eq("v5 questions differ by assessor: anggota → kadiv", v5section("Anggota Ristek", "Kadiv Ristek").questions.map((q: any) => [q.category, q.type]), [["Penilaian umum", "scale"], ["Umpan balik anggota", "text"]]);
eq("v5 questions differ by assessor: sekdiv → kadiv", v5section("Sekdiv Ristek", "Kadiv Ristek").questions.map((q: any) => [q.category, q.type]), [["Penilaian umum", "scale"]]);
eq("v5 required count follows pair matrix", [v5preview.body.data.entries.find((e: any) => e.name === "Anggota Ristek").required, v5preview.body.data.entries.find((e: any) => e.name === "Sekdiv Ristek").required], [8, 5]);

// Blocker: pasangan yang belum punya instrumen harus menghalangi publikasi.
const v5gap = await h.req(`${ADMIN}/periods`, { token: "tok-bph", method: "POST", json: { form_kind: "division", title: "QPR matriks bolong", instruments: [{ title: "Hanya presiden", applies: [{ assessor: "controller", target: "president" }], questions: [{ type: "scale", label: "Presiden?", required: true }] }] } });
await h.req(`${ADMIN}/periods/${v5gap.body.data.id}/entries`, { token: "tok-bph", method: "POST", json: { entries: rosterItems } });
const gapPreview = await h.req(`${ADMIN}/periods/${v5gap.body.data.id}/preview`, { token: "tok-bph" });
ok("v5 blocker names uncovered pair", gapPreview.body.data.blockers.some((b: string) => b.includes("Sekretaris Umum") && b.includes("Sekretaris Divisi")));
eq("v5 open blocked by uncovered pairs", (await h.req(`${ADMIN}/periods/${v5gap.body.data.id}/open`, { token: "tok-bph", method: "POST" })).status, 422);

eq("v5 open", (await h.req(`${ADMIN}/periods/${v5id}/open`, { token: "tok-bph", method: "POST" })).status, 200);
const memberDraft5 = (await h.req(`${PUB}/${v5id}/entries/${v5entry("Anggota Ristek").id}/draft`)).body.data;
eq("v5 member path has base + member instrument", memberDraft5.questions.length, 8);
eq("v5 member final accepted", (await h.req(`${PUB}/${v5id}/submit-v2`, { method: "POST", json: { entry_id: v5entry("Anggota Ristek").id, expected_version: 0, answers: full(memberDraft5) } })).status, 200);
const v5resp = await h.sql(`SELECT role, target_ids, score_total FROM qpr_responses WHERE period_id=?`, v5id);
eq("v5 score = scale only (essay 0)", { role: v5resp[0].role, score: v5resp[0].score_total }, { role: "anggota", score: 16 });
eq("v5 target_ids unchanged", (JSON.parse(v5resp[0].target_ids) as string[]).map((id) => v5rows.body.data.find((e: any) => e.id === id).name).sort(), ["Kadiv Ristek", "Presiden Satu", "Wakadiv Ristek", "Wapres Satu"]);
const v5recap = await h.req(`${ADMIN}/periods/${v5id}/recap-v2`, { token: "tok-bph" });
const v5kadiv = v5recap.body.data.sections.find((s: any) => s.target_label === "Kadiv Ristek");
eq("v5 recap keeps instruments apart", v5kadiv.questions.map((q: any) => [q.category, q.responses]), [["Penilaian umum", 1], ["Umpan balik anggota", 1]]);
eq("v5 recap scale mean", v5kadiv.questions.find((q: any) => q.type === "scale").mean, 4);
const v5csv = await h.req(`${ADMIN}/periods/${v5id}/export`, { token: "tok-bph" });
const v5csvText = typeof v5csv.body === "string" ? v5csv.body : "";
ok("v5 export separates instrument question ids", v5csvText.includes(`${v5entry("Kadiv Ristek").id}~inst-1-q1`) && v5csvText.includes(`${v5entry("Kadiv Ristek").id}~inst-2-q1`));

// Editor matriks: ganti seluruh daftar instrumen sebelum dibuka.
const editableV5 = await h.req(`${ADMIN}/periods`, { token: "tok-bph", method: "POST", json: { form_kind: "division", title: "QPR editor matriks", instruments: [] } });
const editableV5Id = editableV5.body.data.id;
const editedInstruments = [
	{ id: "inst-1", title: "Visi", applies: feasiblePairs, questions: [{ id: "inst-1-q1", type: "scale", label: "Visi jelas?", required: true }] },
	{ id: "inst-2", title: "Etika", applies: feasiblePairs.filter((p: any) => p.target !== "anggota"), questions: [{ id: "inst-2-q1", type: "text", label: "Contoh etika?", required: false }] },
];
const editV5 = await h.req(`${ADMIN}/periods/${editableV5Id}`, { token: "tok-bph", method: "PUT", json: { instruments: editedInstruments, expected_snapshot: editableV5.body.data.questions } });
eq("v5 instrument edit accepted", editV5.status, 200);
eq("v5 instrument edit replaces list", editV5.body.data.questions.instruments.map((i: any) => [i.title, i.applies.length, i.questions.length]), [["Visi", feasiblePairs.length, 1], ["Etika", feasiblePairs.filter((p: any) => p.target !== "anggota").length, 1]]);
eq("v5 stale instrument baseline rejected", (await h.req(`${ADMIN}/periods/${editableV5Id}`, { token: "tok-bph", method: "PUT", json: { instruments: editedInstruments, expected_snapshot: editableV5.body.data.questions } })).status, 409);
eq("v5 instrument edit needs baseline", (await h.req(`${ADMIN}/periods/${editableV5Id}`, { token: "tok-bph", method: "PUT", json: { instruments: editedInstruments } })).status, 422);
eq("v5 categories rejected on matrix period", (await h.req(`${ADMIN}/periods/${editableV5Id}`, { token: "tok-bph", method: "PUT", json: { categories: editedCategories, expected_snapshot: editV5.body.data.questions } })).status, 422);

// Upgrade v4 → v5: pertanyaan lama dipertahankan, routing jadi matriks.
const upgradeBase = await h.req(`${ADMIN}/periods`, { token: "tok-bph", method: "POST", json: { form_kind: "division", title: "QPR upgrade matriks", categories: TOPIC_CATEGORIES } });
await h.req(`${ADMIN}/periods/${upgradeBase.body.data.id}/entries`, { token: "tok-bph", method: "POST", json: { entries: rosterItems } });
const upgraded = await h.req(`${ADMIN}/periods/${upgradeBase.body.data.id}/upgrade-matrix`, { token: "tok-bph", method: "POST" });
eq("v4 → v5 upgrade accepted", upgraded.status, 200);
eq("upgrade keeps categories as instruments", upgraded.body.data.questions.instruments.map((i: any) => [i.title, i.id, i.questions[0].id]), [["Kepemimpinan", "cat-1", "cat-1-q1"], ["Komunikasi", "cat-2", "cat-2-q1"], ["Kedisiplinan", "cat-3", "cat-3-q1"]]);
ok("upgrade maps scope all to every feasible pair", upgraded.body.data.questions.instruments[0].applies.length === feasiblePairs.length);
ok("upgrade maps scope positions to non-member targets", upgraded.body.data.questions.instruments[2].applies.every((p: any) => p.target !== "anggota") && upgraded.body.data.questions.instruments[2].applies.length > 0);
eq("upgraded period still has no blockers", (await h.req(`${ADMIN}/periods/${upgradeBase.body.data.id}/preview`, { token: "tok-bph" })).body.data.blockers, []);
eq("v4 → v5 upgrade is idempotent", (await h.req(`${ADMIN}/periods/${upgradeBase.body.data.id}/upgrade-matrix`, { token: "tok-bph", method: "POST" })).body.data.questions.version, 5);


// ── Status efektif (T1): jadwal menentukan Terjadwal/Berlangsung/Ditutup ────
section("Effective status");
const now = Date.now();
const schedPeriod = await qprService.createPeriod(realDb, { title: "Status efektif", questions: [QUESTIONS[0]], userId: "u-bph", opens_at: new Date(now + 3_600_000).toISOString(), closes_at: new Date(now + 86_400_000).toISOString() });
await qprService.addEntries(realDb, schedPeriod.id, [{ name: "Status Responden" }]);
await qprService.setStatus(realDb, schedPeriod.id, "open");
const schedList = (await h.req(`${ADMIN}/periods`, { token: "tok-bph" })).body?.data?.find((p: any) => p.id === schedPeriod.id);
eq("open + opens_at future = scheduled", schedList?.effective_status, "scheduled");
const schedRoster = await h.req(`${PUB}/${schedPeriod.id}`);
eq("scheduled public info: status only", [schedRoster.status, schedRoster.body?.data?.isOpen, schedRoster.body?.data?.effective_status, schedRoster.body?.data?.remaining, schedRoster.body?.data?.questions], [200, false, "scheduled", [], null]);
eq("scheduled public info keeps schedule", schedRoster.body?.data?.opens_at, schedPeriod.opensAt);
await h.sql(`UPDATE qpr_periods SET opens_at=?, closes_at=? WHERE id=?`, new Date(now - 3_600_000).toISOString(), new Date(now + 3_600_000).toISOString(), schedPeriod.id);
const openList = (await h.req(`${ADMIN}/periods`, { token: "tok-bph" })).body?.data?.find((p: any) => p.id === schedPeriod.id);
eq("open inside window = open", openList?.effective_status, "open");
await h.sql(`UPDATE qpr_periods SET closes_at=? WHERE id=?`, new Date(now - 1_000).toISOString(), schedPeriod.id);
const pastList = (await h.req(`${ADMIN}/periods`, { token: "tok-bph" })).body?.data?.find((p: any) => p.id === schedPeriod.id);
eq("open past closes_at = closed", pastList?.effective_status, "closed");
const pastRoster = await h.req(`${PUB}/${schedPeriod.id}`);
eq("expired public info: closed, no roster", [pastRoster.status, pastRoster.body?.data?.isOpen, pastRoster.body?.data?.effective_status, pastRoster.body?.data?.remaining], [200, false, "closed", []]);
eq("closed public info hides questions", pastRoster.body?.data?.questions, null);
// Tutup manual mengalahkan jadwal: status closed tetap closed meski jendela aktif.
await h.sql(`UPDATE qpr_periods SET status='closed', closes_at=? WHERE id=?`, new Date(now + 3_600_000).toISOString(), schedPeriod.id);
const closedList = (await h.req(`${ADMIN}/periods`, { token: "tok-bph" })).body?.data?.find((p: any) => p.id === schedPeriod.id);
eq("manual closed beats schedule", closedList?.effective_status, "closed");

// Batas persis (kontrak opens_at <= now < closes_at), clock diinjeksi.
section("Schedule boundary");
const bound = (opens_at: string | null, closes_at: string | null, status = "open") => ({ status, opensAt: opens_at, closesAt: closes_at });
const T = Date.parse("2026-10-20T10:00:00+07:00");
eq("opens_at = now is open", effectiveStatus(bound("2026-10-20T10:00:00+07:00", null), T), "open");
eq("1ms before opens_at is scheduled", effectiveStatus(bound("2026-10-20T10:00:00.001+07:00", null), T), "scheduled");
eq("1ms before closes_at is open", effectiveStatus(bound(null, new Date(T + 1).toISOString()), T), "open");
eq("closes_at = now is closed", effectiveStatus(bound(null, "2026-10-20T10:00:00+07:00"), T), "closed");
eq("manual closed beats active window", effectiveStatus(bound(null, new Date(T + 86_400_000).toISOString(), "closed"), T), "closed");
eq("draft status ignores schedule", effectiveStatus(bound(null, null, "draft"), T), "draft");
eq("mixed offsets compare as instants", effectiveStatus(bound("2026-10-20T03:00:00Z", "2026-10-19T22:00:00-05:00"), T), "closed");
// Jadwal tutup = buka ditolak saat create/update.
const sameSchedule = await h.req(`${ADMIN}/periods`, { token: "tok-bph", method: "POST", json: { title: "Jadwal sama", questions: [QUESTIONS[0]], opens_at: "2026-11-01T08:00:00+07:00", closes_at: "2026-11-01T08:00:00+07:00" } });
eq("opens_at == closes_at rejected", [sameSchedule.status, String(sameSchedule.body?.message).includes("Jadwal tutup harus setelah buka")], [422, true]);
const inverted = await h.req(`${ADMIN}/periods`, { token: "tok-bph", method: "POST", json: { title: "Jadwal terbalik", questions: [QUESTIONS[0]], opens_at: "2026-11-01T09:00:00+07:00", closes_at: "2026-11-01T08:00:00+07:00" } });
eq("closes_at before opens_at rejected", inverted.status, 422);

console.log(`\n${passed} passed, ${failed} failed`);
// Miniflare/workerd menahan event loop setelah dispose() — exit eksplisit.
process.exit(failed ? 1 : 0);
