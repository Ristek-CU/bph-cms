/**
 * Self-check chatStream (SSE) — jalur utama panel Roro. LLM di-stub lewat
 * RORO_MOCK_STREAM (array respons; tiap respons = array StreamEvent). Yang diuji:
 * alur SSE endpoint, form create via stream+confirm, tool baca get_form_stats
 * (regresi: input tool dibuang di runReadTool), insight injeksi data asli, guard
 * klaim palsu, dan fake-call guard.
 * Run: tsx src/assistant-stream.test.ts
 */
import { startHarness, type Harness } from "./test/harness";
import { handleToolUse } from "./modules/assistant/service";
import type { LlmToolResult } from "./modules/assistant/llm";
import { getDb } from "./db/connection";

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

// Parse SSE body jadi daftar event.
const parseSse = (text: string) =>
	text
		.split("\n\n")
		.map((chunk) => chunk.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim())
		.filter(Boolean)
		.map((d) => JSON.parse(d!));

const sseText = (events: any[]) =>
	events
		.filter((e) => e.type === "text")
		.map((e) => e.text)
		.join("");

const th = (t: string) => ({ type: "thinking", text: t });
const tx = (t: string) => ({ type: "text", text: t });
const tu = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input, stop_reason: "tool_use" });

// ID + slug fix — diketahui sebelum mock dibangun (queue di workerd globalThis,
// tidak bisa dimutasi dari Node). Seeded via SQL di bawah.
const FORM_ID = "01a0aaaa-0000-7000-8000-00000000face";
const FORM_SLUG = "stream-panitia";
const FIELD_ID = "01a0aaaa-0000-7000-8000-00000000f1e1";
const DIV_A = "01990001-0000-7000-8000-000000000002";

const EVENT_OK = {
	title: "Streaming Futsal Cup",
	starts_at: "2026-10-10T08:00:00+07:00",
	ends_at: "2026-10-10T17:00:00+07:00",
	location: "Lapangan Kampus",
};

// Urutan respons stream sepanjang suite.
const MOCK_STREAM = [
	// S1: create_event via stream (thinking → tool_use → ditutup teks).
	[
		th("User mau event futsal, detail lengkap."),
		tu("tu-s1", "create_event", EVENT_OK),
	],
	[tx("Draf event futsal sudah kusiapkan — cek kartunya, tinggal konfirmasi.")],
	// S2: get_form_stats DENGAN form_id — regresi runReadTool buang input.
	[
		th("Cek statistik form dulu."),
		tu("tu-s2", "get_form_stats", { form_id: FORM_ID }),
	],
	[tx("Statistik form terlampir.")],
	// S3: insight — teks polos, data asli di system prompt (WANTS_INSIGHT match).
	[th("Lihat data respons form..."), tx("Total respons form kamu 2. Semua pilih Ya.")],
	// S4: guard klaim palsu — model bilang event sudah dibuat tanpa tool_use.
	[tx("✅ Event berhasil dibuat di sistem.")],
	// S5: guard fake-call — panggil tool sebagai teks.
	[tx("[get_form_stats: semua] Ada 87 respons bulan ini.")],
	[tx("Maaf, datanya belum bisa aku ambil sekarang.")],
	// S6: rescue — tool call bocor sebagai teks + JSON mentah (tanpa bracket).
	[
		tx(
			"Siap! Detailnya lengkap, langsung aku buatkan.\n\ncreate_event " +
				JSON.stringify(EVENT_OK, null, 2) +
				"\n\nDraft sudah kususun, tinggal konfirmasi.",
		),
	],
	// S7: rescue wrapper — {"tool": "create_form", "params": {...}} bocor sbg teks.
	[
		tx(
			"Baik, aku langsung buat draft formnya. Berikut data yang aku kirim:\n\n" +
				JSON.stringify({ tool: "create_form", params: { title: "Wrapper Form", fields: [{ label: "Nama", type: "short_text", required: true }] } }, null, 2),
		),
	],
	// S8: janji draf tanpa tool call — model cerita form dalam prosa.
	[tx("Oke! Aku susun draftnya sekarang. Berikut draft formnya:\n\nJudul: Form Prosa\n1. Nama — wajib\n\nDraft ini berstatus DRAFT.")],
	[
		th("Sistem minta tool call..."),
		tu("tu-s8", "create_event", EVENT_OK),
	],
	[tx("Draf event sudah kususulkan lewat kartu — tinggal konfirmasi.")],
];

const h: Harness = await startHarness({
	vars: { RORO_MOCK_STREAM: JSON.stringify(MOCK_STREAM), RORO_DAILY_LIMIT: "10" },
});

const ASST = "/api/v1/admin/assistant";

// Seed form published milik divisi Ristek dengan ID fix + 2 submission "Ya".
const now = new Date().toISOString();
await h.sql(
	`INSERT INTO forms (id, division_id, slug, title, status, background_color, created_at, updated_at)
	 VALUES (?, ?, ?, ?, 'published', '#F6F4EF', ?, ?)`,
	FORM_ID, DIV_A, FORM_SLUG, "Form Pendaftaran Panitia", now, now,
);
await h.sql(
	`INSERT INTO form_fields (id, form_id, label, type, options, required, active, sort_order, created_at, updated_at)
	 VALUES (?, ?, 'Setuju?', 'multiple_choice', ?, 1, 1, 0, ?, ?)`,
	FIELD_ID, FORM_ID, JSON.stringify(["Ya", "Tidak"]), now, now,
);
for (let i = 0; i < 2; i++) {
	const subId = `01a0aaaa-0000-7000-8000-00000000sub${i}`;
	const ansId = `01a0aaaa-0000-7000-8000-00000000ans${i}`;
	await h.sql(
		`INSERT INTO form_submissions (id, form_id, status, created_at, updated_at) VALUES (?, ?, 'new', ?, ?)`,
		subId, FORM_ID, now, now,
	);
	await h.sql(
		`INSERT INTO form_answers (id, submission_id, field_id, field_label, field_type, value, created_at)
		 VALUES (?, ?, ?, 'Setuju?', 'multiple_choice', ?, ?)`,
		ansId, subId, FIELD_ID, JSON.stringify("Ya"), now,
	);
}

// ── SSE endpoint + create_event via stream ──────────────────────────────────
section("Stream: proposal via SSE");

const s1 = await h.req(`${ASST}/chat/stream`, {
	token: "tok-a-admin",
	method: "POST",
	json: { message: "Buatin event futsal 10 Oktober ya" },
});
eq("stream → 200", s1.status, 200);
ok("content-type SSE", (s1.headers.get("Content-Type") ?? "").includes("text/event-stream"), s1.headers.get("Content-Type"));
const ev1 = parseSse(s1.body);
ok("ada event thinking", ev1.some((e) => e.type === "thinking"), ev1.map((e) => e.type));
ok("ada event tool_use (create_event)", ev1.some((e) => e.type === "done" && e.proposal?.tool === "create_event"), ev1.map((e) => e.type));
const done1 = ev1.find((e) => e.type === "done");
ok("done membawa reply", (done1?.reply ?? "").includes("kusiapkan"), done1?.reply);
const convS = done1?.conversation_id;

// Confirm → event draft benar-benar terbentuk.
const conf = await h.req(`${ASST}/confirm`, {
	token: "tok-a-admin",
	method: "POST",
	json: { conversation_id: convS, message_id: done1.message_id },
});
eq("confirm stream proposal → 200", conf.status, 200);
const evRow = await h.sql("SELECT title, status FROM events WHERE id = ?", conf.body?.data?.resource_id);
eq("event draft terbentuk", evRow[0]?.title, "Streaming Futsal Cup");
eq("status draft", evRow[0]?.status, "draft");

// ── get_form_stats via tool loop (input diteruskan) ─────────────────────────
section("Stream: get_form_stats (input tool diteruskan)");

// Regresi langsung: dulu runReadTool membuang input tool ({}), get_form_stats
// selalu gagal "form_id wajib" walau model mengirimnya.
{
	const results: LlmToolResult[] = [];
	const actor = {
		userId: "u-a-admin",
		permissions: [
			"forms.read.own_division",
			"forms.submissions.own_division",
			"forms.create.own_division",
			"events.create.own_division",
		],
		recordAudit: async () => {},
	};
	const proposal = await handleToolUse(
		actor as any,
		{ db: getDb(h.d1 as any), divisionId: DIV_A, userId: "u-a-admin" },
		{ id: "tu-dir", name: "get_form_stats", input: { form_id: FORM_ID } },
		results,
	);
	ok("tool_result sukses (input diteruskan)", results[0]?.is_error !== true, results[0]);
	ok("read tool tidak menghasilkan proposal", proposal === null);
}

const s2 = await h.req(`${ASST}/chat/stream`, {
	token: "tok-a-admin",
	method: "POST",
	json: { conversation_id: convS, message: "Berapa respons form pendaftaran panitia?" },
});
eq("stream stats → 200", s2.status, 200);
const ev2 = parseSse(s2.body);
const done2 = ev2.find((e) => e.type === "done");
eq("reply statistik balik", done2?.reply, "Statistik form terlampir.");

// ── Insight: data asli ter-inject (total 2, bukan karangan) ─────────────────
section("Stream: insight responden");

const s3 = await h.req(`${ASST}/chat/stream`, {
	token: "tok-a-admin",
	method: "POST",
	json: { conversation_id: convS, message: "Kasih insight jawaban responden form itu dong" },
});
eq("stream insight → 200", s3.status, 200);
const ev3 = parseSse(s3.body);
const done3 = ev3.find((e) => e.type === "done");
eq("reply insight balik", done3?.reply, "Total respons form kamu 2. Semua pilih Ya.");

// ── Guard: klaim "event sudah dibuat" tanpa proposal ────────────────────────
section("Guard anti-halusinasi");

const s4 = await h.req(`${ASST}/chat/stream`, {
	token: "tok-a-admin",
	method: "POST",
	json: { conversation_id: convS, message: "cek status ya" },
});
const ev4 = parseSse(s4.body);
const done4 = ev4.find((e) => e.type === "done");
ok(
	"klaim palsu diganti pesan jujur",
	(done4?.reply ?? "").includes("draf belum terbentuk"),
	done4?.reply,
);

// ── Guard: fake tool call sebagai teks ──────────────────────────────────────
const s5 = await h.req(`${ASST}/chat/stream`, {
	token: "tok-a-admin",
	method: "POST",
	json: { conversation_id: convS, message: "rekap donk" },
});
const ev5 = parseSse(s5.body);
const done5 = ev5.find((e) => e.type === "done");
ok(
	"fake-call dibuang, diganti jawaban jujur",
	(done5?.reply ?? "").includes("belum bisa"),
	done5?.reply,
);

// ── Rescue: tool call bocor sebagai teks + JSON mentah → jadi proposal ──────
section("Rescue tool-call-as-text");

const s6 = await h.req(`${ASST}/chat/stream`, {
	token: "tok-a-admin",
	method: "POST",
	json: { conversation_id: convS, message: "buatin event lagi tapi lewat chat biasa" },
});
const ev6 = parseSse(s6.body);
const done6 = ev6.find((e) => e.type === "done");
eq("rescued jadi proposal create_event", done6?.proposal?.tool, "create_event");
eq("rescued data tervalidasi", done6?.proposal?.data?.title, "Streaming Futsal Cup");
ok("JSON mentah dibuang dari reply", !(done6?.reply ?? "").includes('"title"'), done6?.reply);
ok("sapaan lain tetap ada", (done6?.reply ?? "").includes("kususun"), done6?.reply);

// ── Rescue varian wrapper: {"tool": "create_form", "params": ...} ───────────
section("Rescue wrapper JSON");

const s7 = await h.req(`${ASST}/chat/stream`, {
	token: "tok-a-admin",
	method: "POST",
	json: { conversation_id: convS, message: "buatin form lewat wrapper" },
});
const ev7 = parseSse(s7.body);
const done7 = ev7.find((e) => e.type === "done");
eq("wrapper rescued jadi proposal create_form", done7?.proposal?.tool, "create_form");
eq("wrapper data tervalidasi", done7?.proposal?.data?.title, "Wrapper Form");
ok("wrapper JSON dibuang dari reply", !(done7?.reply ?? "").includes('"params"'), done7?.reply);

// ── Janji draf tanpa tool call → dipaksa ronde dengan tool ──────────────────
section("Promise-draft prose guard");

const s8 = await h.req(`${ASST}/chat/stream`, {
	token: "tok-a-admin",
	method: "POST",
	json: { conversation_id: convS, message: "kejar form prosa" },
});
const ev8 = parseSse(s8.body);
const done8 = ev8.find((e) => e.type === "done");
eq("prosa → dipaksa tool call → proposal", done8?.proposal?.tool, "create_event");
ok("prosa dibuang, ganti ringkasan draf", (done8?.reply ?? "").includes("kususulkan"), done8?.reply);
ok("prosa lama tidak bocor", !(done8?.reply ?? "").includes("Form Prosa"), done8?.reply);

// ── Tanpa key → fail-closed via stream (bukan 500) ──────────────────────────
section("Fail-closed via stream");

const h2: Harness = await startHarness({});
const nk = await h2.req(`${ASST}/chat/stream`, {
	token: "tok-a-admin",
	method: "POST",
	json: { message: "hai" },
});
eq("tanpa key → tetap 200 (error di-stream)", nk.status, 200);
const evNk = parseSse(nk.body);
ok("pesan ramah ter-stream", sseText(evNk).includes("tidak bisa dihubungi"), sseText(evNk));

await h.dispose();
await h2.dispose();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
	console.error(`GAGAL: ${failures.join(" · ")}`);
	process.exit(1);
}
