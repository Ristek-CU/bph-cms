/**
 * Self-check modul Roro AI — RORO-PLAN.md §5.
 * LLM di-stub lewat var RORO_MOCK (urutan respons Anthropic-shape). Yang diuji:
 * guard auth, tool baca otomatis, proposal tulis tervalidasi + pending, confirm
 * dengan RBAC + audit + anti-dobel, isolasi antar user, kuota harian, fail-closed
 * tanpa key.
 * Run: tsx src/assistant.test.ts
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

const text = (t: string) => ({
	content: [{ type: "text", text: t }],
	stop_reason: "end_turn",
	usage: { input_tokens: 10, output_tokens: 5 },
});
const toolUse = (id: string, name: string, input: unknown) => ({
	content: [{ type: "tool_use", id, name, input }],
	stop_reason: "tool_use",
	usage: { input_tokens: 20, output_tokens: 8 },
});

// Event valid — payload yang akan diusulkan LLM lewat tool create_event.
const EVENT_OK = {
	title: "Lomba Futsal antar UKM",
	starts_at: "2026-10-10T08:00:00+07:00",
	ends_at: "2026-10-10T17:00:00+07:00",
	location: "Lapangan Futsal Kampus",
};
// Sama tapi tanpa location — harus ditolak validasi sebelum jadi proposal.
const EVENT_BAD = { title: "Seminar", starts_at: "2026-10-11T08:00:00+07:00", ends_at: "2026-10-11T10:00:00+07:00" };

// Urutan respons = urutan panggilan llmChat sepanjang suite (lihat komentar tiap test).
const MOCK = [
	toolUse("tu1", "get_events", {}), // A1: Roro membaca event divisi dulu
	text("Aku sudah cek jadwal divisi kamu. Mau buat event apa?"),
	toolUse("tu2", "create_event", EVENT_OK), // A2: usulan event valid
	text("Draf event futsal sudah kusiapkan — cek kartunya, nanti tinggal publish."),
	toolUse("tu3", "create_event", EVENT_OK), // V1: viewer tidak punya izin create
	text("Maaf, akun kamu belum punya izin membuat event. Minta admin divisi ya."),
	toolUse("tu4", "create_event", EVENT_BAD), // A3: payload invalid
	text("Lokasinya di mana? Setelah aku tahu, aku susun ulang drafnya."),
	toolUse("tu5", "get_internal_events", {}), // IE1: baca agenda internal
	text("Agenda internal divisi kamu dan divisi lain sudah kucek, aman."),
	toolUse("tu6", "create_internal_event", EVENT_OK), // IE2: usulan agenda internal
	text("Draf agenda internal rapat koordinasi sudah kusiapkan — cek kartunya."),
];

const h: Harness = await startHarness({ vars: { RORO_MOCK: JSON.stringify(MOCK), RORO_DAILY_LIMIT: "5" } });

const ASST = "/api/v1/admin/assistant";

// ── Guard ───────────────────────────────────────────────────────────────────
section("Akses");

const noAuth = await h.req(`${ASST}/chat`, { method: "POST", json: { message: "hai" } });
eq("tanpa token → 401", noAuth.status, 401);

// ── Chat A1: tool baca + percakapan baru ────────────────────────────────────
section("Chat + tool baca");

const a1 = await h.req(`${ASST}/chat`, {
	token: "tok-a-admin",
	method: "POST",
	json: { message: "Bantu aku lihat event yang ada dong, lalu aku mau buat baru" },
});
eq("chat → 200", a1.status, 200);
eq("reply teks balik", a1.body?.data?.reply, "Aku sudah cek jadwal divisi kamu. Mau buat event apa?");
eq("tanpa proposal", a1.body?.data?.proposal, null);
const convA = a1.body?.data?.conversation_id;
ok("conversation_id balik", typeof convA === "string" && convA.length > 10);

// Tool baca hanya melihat divisi sendiri — scope Ristek, bukan semua.
const seen = await h.sql("SELECT count(*) AS n FROM events");
eq("get_events tidak membuat event", Number(seen[0]?.n ?? 0), 0);

// ── Isolasi antar user ──────────────────────────────────────────────────────
section("Isolasi percakapan");

const peek = await h.req(`${ASST}/conversations/${convA}`, { token: "tok-b-admin" });
eq("chat user lain → 404", peek.status, 404);
const del = await h.req(`${ASST}/conversations/${convA}`, { token: "tok-b-admin", method: "DELETE" });
eq("hapus chat user lain → 404", del.status, 404);

// ── Chat A2: proposal create_event pending ──────────────────────────────────
section("Proposal create_event");

const a2 = await h.req(`${ASST}/chat`, {
	token: "tok-a-admin",
	method: "POST",
	json: { conversation_id: convA, message: "Buatin event lomba futsal 10 Oktober ya, lapangan kampus, jam 8-5" },
});
eq("chat A2 → 200", a2.status, 200);
eq("proposal tool", a2.body?.data?.proposal?.tool, "create_event");
eq("proposal title", a2.body?.data?.proposal?.data?.title, "Lomba Futsal antar UKM");
const msgA2 = a2.body?.data?.message_id;

const pending = await h.req(`${ASST}/conversations/${convA}`, { token: "tok-a-admin" });
eq(
	"pesan tersimpan dengan proposal pending",
	pending.body?.data?.find((m: any) => m.id === msgA2)?.proposal_status,
	"pending",
);

// ── Confirm: viewer ditolak, admin jadi, dobel ditolak ──────────────────────
section("Confirm + RBAC + audit");

const before = await h.sql("SELECT count(*) AS n FROM events");
// (masih 0 — proposal belum dieksekusi)

// Regresi: kegagalan setelah proposal diklaim tidak boleh membuat retry 409.
await h.sql("CREATE TRIGGER fail_assistant_event BEFORE INSERT ON events BEGIN SELECT RAISE(FAIL, 'injected create failure'); END");
const confFailed = await h.req(`${ASST}/confirm`, {
	token: "tok-a-admin",
	method: "POST",
	json: { conversation_id: convA, message_id: msgA2 },
});
eq("confirm gagal di tengah → 500", confFailed.status, 500);
const statusAfterFailure = await h.sql("SELECT proposal_status FROM ai_messages WHERE id = ?", msgA2);
eq("proposal kembali pending supaya bisa dicoba ulang", statusAfterFailure[0]?.proposal_status, "pending");
await h.sql("DROP TRIGGER fail_assistant_event");

const confA = await h.req(`${ASST}/confirm`, {
	token: "tok-a-admin",
	method: "POST",
	json: { conversation_id: convA, message_id: msgA2 },
});
eq("confirm admin divisi → 200", confA.status, 200);
eq("resource_id balik", typeof confA.body?.data?.resource_id, "string");

const evId = confA.body?.data?.resource_id;
const evRow = await h.sql("SELECT title, status, division_id FROM events WHERE id = ?", evId);
eq("event draft terbentuk", evRow[0]?.title, "Lomba Futsal antar UKM");
eq("status tetap draft", evRow[0]?.status, "draft");
eq("owner divisi Ristek", evRow[0]?.division_id, "01990001-0000-7000-8000-000000000002");

const audit = await h.sql(
	"SELECT action, actor_email FROM audit_logs WHERE resource_id = ? AND action LIKE 'assistant%'",
	evId,
);
eq("audit tercatat via roro", audit[0]?.action, "assistant.confirm_create_event");

const confAgain = await h.req(`${ASST}/confirm`, {
	token: "tok-a-admin",
	method: "POST",
	json: { conversation_id: convA, message_id: msgA2 },
});
eq("retry confirm → 200 idempoten", confAgain.status, 200);
eq("retry mengembalikan resource yang sama", confAgain.body?.data?.resource_id, evId);

const after = await h.sql("SELECT count(*) AS n FROM events");
eq("hanya 1 event dibuat", Number(after[0]?.n), Number(before[0]?.n) + 1);

// ── Chat V1: viewer tidak dapat proposal ────────────────────────────────────
section("Viewer tanpa izin create");

const v1 = await h.req(`${ASST}/chat`, {
	token: "tok-a-viewer",
	method: "POST",
	json: { message: "Buatin event dong" },
});
eq("chat viewer → 200", v1.status, 200);
eq("proposal null (izin ditolak di loop)", v1.body?.data?.proposal, null);

// ── Chat A3: payload invalid tidak pernah jadi proposal ─────────────────────
section("Validasi proposal");

const a3 = await h.req(`${ASST}/chat`, {
	token: "tok-a-admin",
	method: "POST",
	json: { conversation_id: convA, message: "Bikin seminar besok pagi" },
});
eq("chat A3 → 200", a3.status, 200);
eq("proposal invalid ditolak", a3.body?.data?.proposal, null);

// ── Agenda internal: baca lintas divisi + usulan draft ──────────────────────
section("Tool agenda internal");

// IE1: get_internal_events — published semua divisi + draft divisi sendiri.
const ie1 = await h.req(`${ASST}/chat`, {
	token: "tok-a-admin",
	method: "POST",
	json: { conversation_id: convA, message: "Cek agenda internal bulan depan dong" },
});
eq("chat IE1 → 200", ie1.status, 200);
eq("tanpa proposal (tool baca)", ie1.body?.data?.proposal, null);

// IE2: create_internal_event → proposal pending, confirm → draft internal event.
const ie2 = await h.req(`${ASST}/chat`, {
	token: "tok-a-admin",
	method: "POST",
	json: { conversation_id: convA, message: "Buatin rapat koordinasi 10 Oktober ya" },
});
eq("chat IE2 → 200", ie2.status, 200);
eq("proposal tool internal", ie2.body?.data?.proposal?.tool, "create_internal_event");
const msgIe2 = ie2.body?.data?.message_id;

const confIe = await h.req(`${ASST}/confirm`, {
	token: "tok-a-admin",
	method: "POST",
	json: { conversation_id: convA, message_id: msgIe2 },
});
eq("confirm internal → 200", confIe.status, 200);
const ieId = confIe.body?.data?.resource_id;
const ieRow = await h.sql("SELECT title, status, division_id FROM internal_events WHERE id = ?", ieId);
eq("internal event draft terbentuk", ieRow[0]?.status, "draft");
eq("owner divisi pemilik", ieRow[0]?.division_id, "01990001-0000-7000-8000-000000000002");

const ieAudit = await h.sql(
	"SELECT action FROM audit_logs WHERE resource_id = ? AND action LIKE 'assistant%'",
	ieId,
);
eq("audit internal tercatat", ieAudit[0]?.action, "assistant.confirm_create_internal_event");

// ── Kuota harian ────────────────────────────────────────────────────────────
section("Kuota");

// tok-a-admin sudah 5 chat hari ini (RORO_DAILY_LIMIT=5) → chat ke-6 ditolak.
const a4 = await h.req(`${ASST}/chat`, {
	token: "tok-a-admin",
	method: "POST",
	json: { conversation_id: convA, message: "masih kuota?" },
});
eq("lewat kuota harian → 429", a4.status, 429);

const usage = await h.req(`${ASST}/usage`, { token: "tok-b-admin" });
eq("usage user lain mulai 0", usage.body?.data?.today?.used, 0);

// ── Tanpa key & tanpa mock → fail-closed, bukan 500 ─────────────────────────
section("Fail-closed tanpa key");

const h2: Harness = await startHarness({});
const nk = await h2.req(`${ASST}/chat`, {
	token: "tok-a-admin",
	method: "POST",
	json: { message: "hai roro" },
});
eq("tanpa key → tetap 200", nk.status, 200);
ok("pesan ramah ke user", (nk.body?.data?.reply ?? "").includes("tidak bisa dihubungi"));

await h.dispose();
await h2.dispose();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
	console.error(`GAGAL: ${failures.join(" · ")}`);
	process.exit(1);
}
