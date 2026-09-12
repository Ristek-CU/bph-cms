/**
 * Self-check modul QPR v1 (docs/QPR-PRD.md §5).
 * Alur: BPH buat periode → tambah penugasan → buka → reviewer submit →
 * revisi → rekap → guard (bukan penugasanmu, periode tertutup, delete guard).
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

const BASE = "/api/v1/admin/qpr";

// ── Akses: non-BPH tidak bisa kelola, tapi bisa /my ─────────────────────────
section("Akses");

const noAuth = await h.req(`${BASE}/periods`, { method: "POST", json: { title: "x", questions: [{ label: "a", category: "b" }] } });
eq("tanpa token → 401", noAuth.status, 401);

const nonBph = await h.req(`${BASE}/periods`, { token: "tok-a-admin" });
eq("division_admin kelola periode → 403", nonBph.status, 403);
const nonBphMy = await h.req(`${BASE}/my`, { token: "tok-a-admin" });
eq("division_admin lihat penugasan sendiri → 200", nonBphMy.status, 200);
eq("penugasan awal kosong", nonBphMy.body?.data?.length, 0);

// ── BPH: periode + penugasan ────────────────────────────────────────────────
section("Periode & penugasan (BPH)");

const QUESTIONS = [
	{ label: "Menyelesaikan tugas tepat waktu", category: "Kinerja" },
	{ label: "Berkolaborasi dengan baik", category: "Kolaborasi" },
];

const created = await h.req(`${BASE}/periods`, {
	token: "tok-bph",
	method: "POST",
	json: { title: "Penilaian September 2026", questions: QUESTIONS, opens_at: "2026-09-01T00:00:00+07:00", closes_at: "2026-12-31T23:59:59+07:00" },
});
eq("buat periode → 201", created.status, 201);
eq("status awal draft", created.body?.data?.status, "draft");
ok("questions tersimpan", JSON.stringify(created.body?.data?.questions) === JSON.stringify(QUESTIONS), created.body?.data?.questions);

const dup = await h.req(`${BASE}/periods`, {
	token: "tok-bph",
	method: "POST",
	json: { title: "Penilaian September 2026", questions: QUESTIONS },
});
eq("judul duplikat → 409", dup.status, 409);

const pid = created.body?.data?.id;

const noAssignOpen = await h.req(`${BASE}/periods/${pid}/open`, { token: "tok-bph", method: "POST" });
eq("buka periode → 200", noAssignOpen.status, 200);

// Penugasan: reviewer = u-a-admin (admin divisi A), dinilai 2 orang.
const assign = await h.req(`${BASE}/periods/${pid}/assignments`, {
	token: "tok-bph",
	method: "POST",
	json: {
		assignments: [
			{ reviewer_user_id: "u-a-admin", reviewer_email: "admin.a@example.com", reviewee_name: "Raka Pratama", reviewee_role: "Anggota Ristek" },
			{ reviewer_user_id: "u-a-admin", reviewer_email: "admin.a@example.com", reviewee_name: "Sinta Dewi", reviewee_role: "Anggota Ristek" },
			{ reviewer_user_id: "u-a-contrib", reviewer_email: "contrib.a@example.com", reviewee_name: "Ketua Ristek", reviewee_role: "Ketua Ristek" },
		],
	},
});
eq("tambah penugasan → 201", assign.status, 201);
eq("3 penugasan dibuat", assign.body?.data?.length, 3);
const rid1 = assign.body?.data?.[0]?.id;
const rid2 = assign.body?.data?.[1]?.id;
const rid3 = assign.body?.data?.[2]?.id;

const myList = await h.req(`${BASE}/my`, { token: "tok-a-admin" });
eq("my assignments reviewer → 2", myList.body?.data?.length, 2);
ok("my assignments bawa pertanyaan", myList.body?.data?.[0]?.questions?.length === 2, myList.body?.data?.[0]);

// ── Submit + guard ──────────────────────────────────────────────────────────
section("Submit penilaian");

const answers = [
	{ label: QUESTIONS[0].label, category: "Kinerja", score: 4 },
	{ label: QUESTIONS[1].label, category: "Kolaborasi", score: 5, note: "Sangat membantu" },
];

const wrongReviewer = await h.req(`${BASE}/assignments/${rid3}/submit`, { token: "tok-a-admin", method: "POST", json: { answers } });
eq("submit penugasan orang lain → 403", wrongReviewer.status, 403);

const badScore = await h.req(`${BASE}/assignments/${rid1}/submit`, {
	token: "tok-a-admin", method: "POST",
	json: { answers: [{ label: "x", category: "y", score: 9 }] },
});
eq("score di luar 1-5 → 422", badScore.status, 422);

const submit1 = await h.req(`${BASE}/assignments/${rid1}/submit`, { token: "tok-a-admin", method: "POST", json: { answers } });
eq("submit penilaian → 200", submit1.status, 200);
eq("status penugasan jadi done", submit1.body?.data?.revised, false);

const revise = await h.req(`${BASE}/assignments/${rid1}/submit`, {
	token: "tok-a-admin", method: "POST",
	json: { answers: [{ label: QUESTIONS[0].label, category: "Kinerja", score: 3 }, { label: QUESTIONS[1].label, category: "Kolaborasi", score: 4, note: "Sangat membantu" }] },
});
eq("revisi saat terbuka → 200", revise.status, 200);
eq("revisi terdeteksi", revise.body?.data?.revised, true);

const afterList = await h.req(`${BASE}/periods/${pid}`, { token: "tok-bph" });
eq("1 dari 3 selesai", afterList.body?.data?.assignments?.filter((a: any) => a.status === "done")?.length, 1);

// ── Tutup periode → submit ditolak ──────────────────────────────────────────
section("Tutup periode");

const closed = await h.req(`${BASE}/periods/${pid}/close`, { token: "tok-bph", method: "POST" });
eq("tutup periode → 200", closed.status, 200);
const submitClosed = await h.req(`${BASE}/assignments/${rid2}/submit`, { token: "tok-a-admin", method: "POST", json: { answers } });
eq("submit setelah tutup → 409", submitClosed.status, 409);

// ── Rekap ───────────────────────────────────────────────────────────────────
section("Rekap");

const recap = await h.req(`${BASE}/periods/${pid}/recap`, { token: "tok-bph" });
eq("rekap → 200", recap.status, 200);
const raka = recap.body?.data?.reviewees?.find((r: any) => r.reviewee_name === "Raka Pratama");
ok("rekap bawa Raka", Boolean(raka), recap.body?.data?.reviewees);
eq("rata-rata revisi = (3+4)/2 = 3.5", raka?.average, 3.5);
eq("rata-rata kategori Kinerja = 3", raka?.categories?.["Kinerja"], 3);
ok("catatan ikut rekap", raka?.notes?.includes("Sangat membantu"), raka?.notes);
const recapDenied = await h.req(`${BASE}/periods/${pid}/recap`, { token: "tok-a-admin" });
eq("rekap oleh non-BPH → 403", recapDenied.status, 403);

// ── Delete guard ────────────────────────────────────────────────────────────
section("Delete guard");

const delWithAnswers = await h.req(`${BASE}/periods/${pid}`, { token: "tok-bph", method: "DELETE" });
eq("hapus periode bersubmission → 409", delWithAnswers.status, 409);
const delAssign = await h.req(`${BASE}/periods/${pid}/assignments/${rid1}`, { token: "tok-bph", method: "DELETE" });
eq("hapus penugasan bersubmission → 200 (jawaban ikut)", delAssign.status, 200);
const delNow = await h.req(`${BASE}/periods/${pid}`, { token: "tok-bph", method: "DELETE" });
eq("hapus periode tanpa submission → 200", delNow.status, 200);

console.log(`\n${passed} passed, ${failed} failed`);
// Miniflare/workerd menahan event loop setelah dispose() — exit eksplisit.
process.exit(failed ? 1 : 0);
