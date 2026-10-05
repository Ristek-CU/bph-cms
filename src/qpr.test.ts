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

console.log(`\n${passed} passed, ${failed} failed`);
// Miniflare/workerd menahan event loop setelah dispose() — exit eksplisit.
process.exit(failed ? 1 : 0);
