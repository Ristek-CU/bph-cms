/**
 * Regresi hasil audit Roro (2026-09-25):
 * 1. Revisi draf → proposal pending lama otomatis ditolak (tidak bisa confirm ganda → duplikat).
 * 2. Sesi di luar rentang event ditolak saat proposal dibentuk, bukan baru saat confirm.
 * 3. Guard salah tool: pesan rapat/koordinasi + tool_use create_event → ditolak, arahkan
 *    ke create_internal_event.
 * Run: tsx src/assistant-audit-regression.test.ts
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

const parseSse = (text: string) =>
	text
		.split("\n\n")
		.map((chunk) => chunk.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim())
		.filter(Boolean)
		.map((d) => JSON.parse(d!));

const tx = (t: string) => ({ type: "text", text: t });
const tu = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input, stop_reason: "tool_use" });

const EVENT_V1 = {
	title: "Event Revisi",
	starts_at: "2026-10-10T08:00:00+07:00",
	ends_at: "2026-10-10T17:00:00+07:00",
	location: "Kampus Kemang",
};
const EVENT_V2 = { ...EVENT_V1, location: "Aula Kemang" };
const SESSION_OOR = {
	title: "Event Sesi Luar",
	starts_at: "2026-10-11T10:00:00+07:00",
	ends_at: "2026-10-11T12:00:00+07:00",
	location: "Lab A",
	sessions: [{ name: "OOR", starts_at: "2026-10-11T09:00:00+07:00", ends_at: "2026-10-11T10:30:00+07:00" }],
};

const MOCK_STREAM = [
	[tu("tu-r1", "create_event", EVENT_V1), tx("Draf event Revisi sudah kusiapkan.")],
	[tu("tu-r2", "create_event", EVENT_V2), tx("Lokasinya sudah kupindah ke Aula Kemang.")],
	// Sesi out-of-range → tool_result is_error → ronde 2 model tanya ulang.
	[tu("tu-r3", "create_event", SESSION_OOR)],
	[tx("Sesinya di luar rentang event — boleh sesuaikan jamnya?")],
	// Guard salah tool: pesan rapat tapi model memanggil create_event.
	[tu("tu-r4", "create_event", { ...EVENT_V1, title: "Rapat Koordinasi Divisi" })],
	[tx("Siap, kupakai create_internal_event untuk rapatnya.")],
];

const h: Harness = await startHarness({
	vars: { RORO_MOCK_STREAM: JSON.stringify(MOCK_STREAM), RORO_DAILY_LIMIT: "10" },
});

const ASST = "/api/v1/admin/assistant";

// ── 1. Revisi draf → proposal lama ditolak, confirm ganda mustahil ──────────
section("Revisi draf menonaktifkan proposal lama");

const c1 = await h.req(`${ASST}/chat/stream`, {
	token: "tok-a-admin",
	method: "POST",
	json: { message: "Buatin event 10 Oktober di kampus kemang ya, jam 8-17" },
});
const done1 = parseSse(c1.body).find((e) => e.type === "done");
ok("proposal v1 muncul", done1?.proposal?.tool === "create_event", done1?.proposal);
const msgP1 = done1.message_id;

const c2 = await h.req(`${ASST}/chat/stream`, {
	token: "tok-a-admin",
	method: "POST",
	json: { conversation_id: done1.conversation_id, message: "lokasinya pindah ke Aula Kemang ya" },
});
const done2 = parseSse(c2.body).find((e) => e.type === "done");
ok("proposal v2 muncul", done2?.proposal?.tool === "create_event", done2?.proposal);
const msgP2 = done2.message_id;
ok("proposal v1 ≠ v2", msgP1 !== msgP2);

const stale = await h.sql(
	"SELECT proposal_status FROM ai_messages WHERE id = ?",
	msgP1,
);
eq("proposal lama jadi rejected", stale[0]?.proposal_status, "rejected");

const confStale = await h.req(`${ASST}/confirm`, {
	token: "tok-a-admin",
	method: "POST",
	json: { conversation_id: done1.conversation_id, message_id: msgP1 },
});
eq("confirm proposal lama → 409", confStale.status, 409);

const conf2 = await h.req(`${ASST}/confirm`, {
	token: "tok-a-admin",
	method: "POST",
	json: { conversation_id: done2.conversation_id, message_id: msgP2 },
});
eq("confirm proposal baru → 200", conf2.status, 200);
const rows = await h.sql("SELECT count(*) AS n FROM events WHERE title = 'Event Revisi'");
eq("hanya 1 event dari 2 proposal", Number(rows[0]?.n), 1);

// ── 2. Sesi out-of-range ditolak sebelum kartu ──────────────────────────────
section("Sesi di luar rentang ditolak di loop");

const c3 = await h.req(`${ASST}/chat/stream`, {
	token: "tok-a-admin",
	method: "POST",
	json: { message: "Buatin event 11 Oktober di Lab A jam 10-12 dengan sesi jam 9-10:30" },
});
const ev3 = parseSse(c3.body);
const done3 = ev3.find((e) => e.type === "done");
ok("tidak ada proposal dari payload sesi luar rentang", done3?.proposal == null, done3?.proposal);
const oorRows = await h.sql("SELECT count(*) AS n FROM events WHERE title = 'Event Sesi Luar'");
eq("tidak ada event dibuat", Number(oorRows[0]?.n), 0);
ok("reply tidak kosong", (done3?.reply ?? "").length > 0, done3?.reply);

// ── 3. Guard salah tool: rapat ≠ create_event ───────────────────────────────
section("Guard rapat → create_internal_event");

const c4 = await h.req(`${ASST}/chat/stream`, {
	token: "tok-a-admin",
	method: "POST",
	json: { message: "Rapat koordinasi divisi 10 Oktober jam 8-17 di ruang rapat ya" },
});
const ev4 = parseSse(c4.body);
const done4 = ev4.find((e) => e.type === "done");
ok("tidak ada proposal create_event dari pesan rapat", done4?.proposal?.tool !== "create_event", done4?.proposal);
const wrongRows = await h.sql(
	"SELECT count(*) AS n FROM events WHERE title = 'Rapat Koordinasi Divisi'",
);
eq("tidak ada row di tabel events", Number(wrongRows[0]?.n), 0);
ok("reply tidak kosong", (done4?.reply ?? "").length > 0, done4?.reply);

console.log(`\n${passed} passed, ${failed} failed`);
await h.dispose();
if (failed) {
	console.error(`Gagal: ${failures.join(", ")}`);
	process.exit(1);
}
