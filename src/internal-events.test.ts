/**
 * Self-check Internal Event (D-AK / K-2 / K-4).
 *
 * Menjalankan Worker asli di Miniflare (D1 nyata, AUTH_SERVICE stub) dan menguji:
 * matriks role, aturan visibilitas K-2 (published lintas divisi, draft privat),
 * isolasi tulis, validasi, runsheet, kalender, audit log — dan yang paling
 * penting: **anti-bocor ke jalur publik**, satu-satunya penjaga keputusan K-4
 * (tabel terpisah) supaya agenda internal tidak pernah sampai ke landing page.
 *
 * Urutan section sengaja: semua assertion daftar-eksak dijalankan SEBELUM ada
 * baris yang dibuat test, supaya hasil tidak bergantung pada sisa section lain.
 *
 * Run: tsx src/internal-events.test.ts
 */
import {
	startHarness,
	seedEvent,
	seedInternalEvent,
	seedInternalSession,
	DIVISIONS,
	type Harness,
} from "./test/harness";

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
const ids = (body: any) => (body?.data?.items ?? []).map((e: any) => e.id).sort();

const h: Harness = await startHarness();

const S = "2026-09-10T08:00:00+07:00";
const E = "2026-09-10T17:00:00+07:00";

// divisi A = Ristek (tok-a-admin / tok-a-contrib / tok-a-viewer), divisi B = UKM.
await seedInternalEvent(h, { id: "ie-a-pub", slug: "ie-a-publik", title: "Internal A Publik", divisionId: DIVISIONS.a.id, status: "published" });
await seedInternalEvent(h, { id: "ie-a-draft", slug: "ie-a-draft", title: "Internal A Draft", divisionId: DIVISIONS.a.id, status: "draft" });
await seedInternalEvent(h, { id: "ie-b-pub", slug: "ie-b-publik", title: "Internal B Publik", divisionId: DIVISIONS.b.id, status: "published" });
await seedInternalEvent(h, { id: "ie-b-draft", slug: "ie-b-draft", title: "Internal B Draft", divisionId: DIVISIONS.b.id, status: "draft" });
await seedInternalSession(h, { id: "ies-b-1", eventId: "ie-b-pub", name: "Sesi B" });

// Event PUBLIK dengan slug yang sama persis dengan internal event. Dipakai untuk
// membuktikan dua hal: namespace slug antar tabel independent, dan internal event
// tidak pernah menyusup ke jalur baca publik walau slug-nya bertabrakan.
await seedEvent(h, { id: "ev-pub-slug", slug: "ie-a-publik", title: "Event Publik Slug Sama", divisionId: DIVISIONS.a.id, status: "published" });

const valid = {
	title: "Rapat Koordinasi Internal",
	starts_at: S,
	ends_at: E,
	location: "Ruang Rapat 2",
};

// PNG 1x1 (magic bytes + IHDR cukup untuk lolos pemeriksaan magic byte).
const pngBytes = Uint8Array.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

function multipart(filename: string, contentType: string, bytes: Uint8Array) {
	const boundary = "----internalmediaboundary";
	const enc = new TextEncoder();
	const head = enc.encode(
		`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
	);
	const tail = enc.encode(`\r\n--${boundary}--\r\n`);
	const body = new Uint8Array(head.length + bytes.length + tail.length);
	body.set(head, 0);
	body.set(bytes, head.length);
	body.set(tail, head.length + bytes.length);
	return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

const uploadInternal = (token: string | undefined, filename: string, contentType: string, bytes: Uint8Array) => {
	const mp = multipart(filename, contentType, bytes);
	return h.req("/api/v1/admin/internal-media", {
		method: "POST",
		token,
		body: mp.body,
		headers: { "Content-Type": mp.contentType },
	});
};

// ── 1. Autentikasi ──────────────────────────────────────────────────────────
section("Autentikasi");

const anonPaths: Array<[string, string]> = [
	["GET", "/api/v1/admin/internal-events"],
	["GET", "/api/v1/admin/internal-events/calendar"],
	["GET", "/api/v1/admin/internal-events/ie-a-pub"],
	["POST", "/api/v1/admin/internal-events"],
	["PUT", "/api/v1/admin/internal-events/ie-a-pub"],
	["DELETE", "/api/v1/admin/internal-events/ie-a-pub"],
	["POST", "/api/v1/admin/internal-events/ie-a-pub/publish"],
	["POST", "/api/v1/admin/internal-events/ie-a-pub/sessions"],
	["PUT", "/api/v1/admin/internal-events/sessions/ies-b-1"],
	["DELETE", "/api/v1/admin/internal-events/sessions/ies-b-1"],
];
for (const [method, path] of anonPaths) {
	const r = await h.req(path, { method, json: method === "GET" ? undefined : valid });
	eq(`tanpa token ${method} ${path.replace("/api/v1/admin/internal-events", "")} → 401`, r.status, 401);
}

const outsider = await h.req("/api/v1/admin/internal-events", { token: "tok-outsider" });
eq("akun tanpa membership → 403", outsider.status, 403);

// ── 2. K-2: visibilitas baca lintas divisi (sebelum ada baris baru) ─────────
section("K-2 — baca lintas divisi");

const listA = await h.req("/api/v1/admin/internal-events", { token: "tok-a-admin" });
eq("division_admin A → 200", listA.status, 200);
eq(
	"A melihat published semua divisi + draft miliknya sendiri",
	ids(listA.body),
	["ie-a-draft", "ie-a-pub", "ie-b-pub"],
);
ok(
	"identitas divisi ikut terkirim",
	(listA.body?.data?.items ?? []).find((e: any) => e.id === "ie-b-pub")?.division_name === "UKM",
	(listA.body?.data?.items ?? []).find((e: any) => e.id === "ie-b-pub"),
);

const viewerList = await h.req("/api/v1/admin/internal-events", { token: "tok-a-viewer" });
eq("viewer boleh baca daftar → 200", viewerList.status, 200);
eq("viewer melihat cakupan yang sama dengan admin divisinya", ids(viewerList.body), ["ie-a-draft", "ie-a-pub", "ie-b-pub"]);

const crossReadPublished = await h.req("/api/v1/admin/internal-events/ie-b-pub", { token: "tok-a-admin" });
eq("A baca detail internal event published divisi B → 200", crossReadPublished.status, 200);
eq("runsheet divisi lain ikut terbaca", crossReadPublished.body?.data?.sessions?.length, 1);

const crossReadDraft = await h.req("/api/v1/admin/internal-events/ie-b-draft", { token: "tok-a-admin" });
eq(
	"A baca draft divisi B → 404 (bukan 403, keberadaannya tidak boleh terungkap)",
	crossReadDraft.status,
	404,
);

const bphList = await h.req("/api/v1/admin/internal-events", { token: "tok-bph" });
eq(
	"platform_admin melihat semuanya termasuk draft divisi lain",
	ids(bphList.body),
	["ie-a-draft", "ie-a-pub", "ie-b-draft", "ie-b-pub"],
);

// ── 3. ANTI-BOCOR ke jalur publik (penjaga keputusan K-4) ───────────────────
section("Anti-bocor ke jalur publik");

const pubList = await h.req("/api/v1/events?limit=50");
eq("GET /api/v1/events → 200", pubList.status, 200);
const pubTitles = (pubList.body?.data?.items ?? []).map((e: any) => e.title);
ok(
	"judul internal event TIDAK muncul di daftar publik",
	!pubTitles.some((t: string) => t.startsWith("Internal ")),
	pubTitles,
);
ok(
	"event publik dengan slug sama tetap terbaca normal",
	pubTitles.includes("Event Publik Slug Sama"),
	pubTitles,
);

const pubCal = await h.req("/api/v1/events/calendar?month=2026-09");
const pubCalTitles = (pubCal.body?.data?.items ?? []).map((e: any) => e.title);
ok(
	"kalender publik tidak memuat internal event",
	!pubCalTitles.some((t: string) => t.startsWith("Internal ")),
	pubCalTitles,
);

for (const slug of ["ie-a-publik", "ie-b-publik", "ie-a-draft", "ie-b-draft"]) {
	const detail = await h.req(`/api/v1/events/${slug}`);
	if (slug === "ie-a-publik") {
		// Slug ini memang dimiliki event publik yang di-seed — pastikan yang
		// dibalas event PUBLIK, bukan internal event yang kebetulan slug-nya sama.
		eq("slug bertabrakan → yang terbaca event publik", detail.body?.data?.title, "Event Publik Slug Sama");
	} else {
		eq(`GET /api/v1/events/${slug} → 404`, detail.status, 404);
	}
}

const adminEvents = await h.req("/api/v1/admin/events", { token: "tok-bph" });
ok(
	"internal event tidak menyusup ke /admin/events",
	!ids(adminEvents.body).some((id: string) => id.startsWith("ie-")),
	ids(adminEvents.body),
);

const adminCal = await h.req("/api/v1/admin/events/calendar?month=2026-09", { token: "tok-bph" });
ok(
	"internal event tidak menyusup ke kalender lintas divisi student event",
	!ids(adminCal.body).some((id: string) => id.startsWith("ie-")),
	ids(adminCal.body),
);

// ── 4. Kalender internal lintas divisi ──────────────────────────────────────
section("Kalender internal");

const cal = await h.req("/api/v1/admin/internal-events/calendar?month=2026-09", { token: "tok-a-admin" });
eq("kalender → 200", cal.status, 200);
eq("hanya published, dari semua divisi", ids(cal.body), ["ie-a-pub", "ie-b-pub"]);
ok(
	"description ikut terkirim (bug kalender student event tidak diulang di sini)",
	"description" in ((cal.body?.data?.items ?? [])[0] ?? {}),
	Object.keys((cal.body?.data?.items ?? [])[0] ?? {}),
);

const calViewer = await h.req("/api/v1/admin/internal-events/calendar?month=2026-09", { token: "tok-a-viewer" });
eq("viewer boleh akses kalender → 200", calViewer.status, 200);

const calEmpty = await h.req("/api/v1/admin/internal-events/calendar?month=2030-01", { token: "tok-a-admin" });
eq("bulan kosong → items []", calEmpty.body?.data?.items, []);

const calDefault = await h.req("/api/v1/admin/internal-events/calendar", { token: "tok-a-admin" });
eq("tanpa ?month → 200 (bulan berjalan WIB)", calDefault.status, 200);

const badMonth = await h.req("/api/v1/admin/internal-events/calendar?month=September", { token: "tok-a-admin" });
eq("month invalid → 422", badMonth.status, 422);

// ── 4b. Media internal — prefix terpisah + servis ber-auth (K-6) ────────────
section("Media internal (K-6)");

const noAuthUpload = await uploadInternal(undefined, "n.png", "image/png", pngBytes);
eq("upload cover internal tanpa token → 401", noAuthUpload.status, 401);

const viewerUpload = await uploadInternal("tok-a-viewer", "v.png", "image/png", pngBytes);
eq("viewer upload cover internal → 403", viewerUpload.status, 403);

const htmlUpload = await uploadInternal(
	"tok-a-admin",
	"payload.html",
	"text/html",
	new TextEncoder().encode("<script>alert(1)</script>"),
);
eq("upload text/html → 422", htmlUpload.status, 422);

const svgUpload = await uploadInternal("tok-a-admin", "payload.svg", "image/svg+xml", new TextEncoder().encode("<svg/>"));
eq("upload image/svg+xml → 422 (SVG bisa membawa script)", svgUpload.status, 422);

const disguised = await uploadInternal(
	"tok-a-admin",
	"cover.png",
	"image/png",
	new TextEncoder().encode("<script>alert(1)</script>"),
);
eq("HTML yang di-rename .png ditolak magic bytes → 422", disguised.status, 422);

const okUpload = await uploadInternal("tok-a-admin", "cover.png", "image/png", pngBytes);
eq("upload PNG valid → 201", okUpload.status, 201);
const internalUrl: string = okUpload.body?.data?.url ?? "";
ok(
	"URL menunjuk endpoint ber-auth, bukan /storage/ publik",
	internalUrl.startsWith("https://bph-cms.test/api/v1/admin/internal-media/"),
	internalUrl,
);
const internalFilename = internalUrl.split("/admin/internal-media/")[1];
ok("nama file = uuidv7 + ekstensi whitelist", /^[0-9a-f-]{36}\.png$/.test(internalFilename ?? ""), internalFilename);

const anonServe = await h.req(`/api/v1/admin/internal-media/${internalFilename}`);
eq("baca cover internal tanpa token → 401", anonServe.status, 401);

const outsiderServe = await h.req(`/api/v1/admin/internal-media/${internalFilename}`, { token: "tok-outsider" });
eq("akun tanpa membership baca cover internal → 403", outsiderServe.status, 403);

const viewerServe = await h.req(`/api/v1/admin/internal-media/${internalFilename}`, { token: "tok-a-viewer" });
eq("viewer (events.read, tanpa media.upload) boleh baca → 200", viewerServe.status, 200);
eq("content-type = image/png", viewerServe.headers.get("content-type"), "image/png");
eq("diberi nosniff", viewerServe.headers.get("x-content-type-options"), "nosniff");
eq(
	"cache-control private, bukan public",
	viewerServe.headers.get("cache-control"),
	"private, max-age=31536000, immutable",
);

const crossDivServe = await h.req(`/api/v1/admin/internal-media/${internalFilename}`, { token: "tok-b-admin" });
eq("divisi lain boleh baca cover (K-2 baca lintas divisi) → 200", crossDivServe.status, 200);

// Inti K-6: objek di prefix internal TIDAK boleh terjangkau jalur storage publik.
const viaPublicStorage = await h.req(`/api/v1/storage/internal-covers/${internalFilename}`);
eq(
	"cover internal lewat /api/v1/storage/ publik → 404",
	viaPublicStorage.status,
	404,
);

const missing = await h.req("/api/v1/admin/internal-media/01890b1a-0000-7000-8000-000000000000.png", { token: "tok-a-admin" });
eq("nama file valid tapi objeknya tidak ada → 404", missing.status, 404);

for (const bad of [
	"..%2fcovers%2fsecret.png",
	"..%2f..%2fsecrets",
	"bukan-uuid.png",
	"01890b1a-0000-7000-8000-000000000000.exe",
]) {
	const r = await h.req(`/api/v1/admin/internal-media/${bad}`, { token: "tok-a-admin" });
	ok(`nama file tidak sah ${decodeURIComponent(bad)} → 404`, r.status === 404, r.status);
}

// ── 5. Validasi ─────────────────────────────────────────────────────────────
section("Validasi");

const badRange = await h.req("/api/v1/admin/internal-events", {
	method: "POST",
	token: "tok-a-admin",
	json: { ...valid, starts_at: E, ends_at: S },
});
eq("ends_at sebelum starts_at → 422", badRange.status, 422);
ok("errors.ends_at terisi", Boolean(badRange.body?.errors?.ends_at), badRange.body?.errors);

const badSession = await h.req("/api/v1/admin/internal-events", {
	method: "POST",
	token: "tok-a-admin",
	json: {
		...valid,
		sessions: [{ name: "Di Luar Rentang", starts_at: "2026-12-01T08:00:00+07:00", ends_at: "2026-12-01T09:00:00+07:00" }],
	},
});
eq("sesi di luar rentang event → 422", badSession.status, 422);
ok("errors menunjuk sesi ke-0", Boolean(badSession.body?.errors?.["sessions.0"]), badSession.body?.errors);

const badSlug = await h.req("/api/v1/admin/internal-events", {
	method: "POST",
	token: "tok-a-admin",
	json: { ...valid, slug: "ie-a-publik" },
});
eq("slug sudah dipakai internal event lain → 409", badSlug.status, 409);

const badJson = await h.req("/api/v1/admin/internal-events", {
	method: "POST",
	token: "tok-a-admin",
	body: "{bukan json",
	headers: { "Content-Type": "application/json" },
});
eq("body JSON rusak → 400", badJson.status, 400);

const notFound = await h.req("/api/v1/admin/internal-events/tidak-ada", { token: "tok-a-admin" });
eq("id tidak ada → 404", notFound.status, 404);

const missingLocation = await h.req("/api/v1/admin/internal-events", {
	method: "POST",
	token: "tok-a-admin",
	json: { title: "Tanpa Lokasi", starts_at: S, ends_at: E },
});
eq("lokasi wajib → 422", missingLocation.status, 422);

// ── 6. Matriks role (mulai menulis baris) ───────────────────────────────────
section("Matriks role");

const viewerCreate = await h.req("/api/v1/admin/internal-events", { method: "POST", token: "tok-a-viewer", json: valid });
eq("viewer create → 403", viewerCreate.status, 403);

const viewerUpdate = await h.req("/api/v1/admin/internal-events/ie-a-pub", { method: "PUT", token: "tok-a-viewer", json: { title: "X" } });
eq("viewer update → 403", viewerUpdate.status, 403);

const viewerPublish = await h.req("/api/v1/admin/internal-events/ie-a-draft/publish", { method: "POST", token: "tok-a-viewer" });
eq("viewer publish → 403", viewerPublish.status, 403);

const contribCreate = await h.req("/api/v1/admin/internal-events", {
	method: "POST",
	token: "tok-a-contrib",
	json: { ...valid, title: "Draft Contributor Internal" },
});
eq("contributor boleh create draft → 201", contribCreate.status, 201);
eq("create selalu draft", contribCreate.body?.data?.status, "draft");
const contribId = contribCreate.body?.data?.id as string;
ok("id internal event dikembalikan", Boolean(contribId), contribId);
eq("division_id = divisi aktif pembuat", contribCreate.body?.data?.division_id, DIVISIONS.a.id);

const forcedPublish = await h.req("/api/v1/admin/internal-events", {
	method: "POST",
	token: "tok-a-contrib",
	json: { ...valid, title: "Coba Terbit Langsung", status: "published" },
});
eq("status:published di body diabaikan → tetap draft", forcedPublish.body?.data?.status, "draft");
const forcedId = forcedPublish.body?.data?.id as string;

const contribPublish = await h.req(`/api/v1/admin/internal-events/${contribId}/publish`, { method: "POST", token: "tok-a-contrib" });
eq("contributor publish → 403", contribPublish.status, 403);

const adminCreate = await h.req("/api/v1/admin/internal-events", {
	method: "POST",
	token: "tok-a-admin",
	json: {
		...valid,
		title: "Rakor Dengan Runsheet",
		sessions: [
			{ name: "Pembukaan", starts_at: "2026-09-10T08:00:00+07:00", ends_at: "2026-09-10T09:00:00+07:00", speaker: "Ketua" },
			{ name: "Pembahasan", starts_at: "2026-09-10T09:00:00+07:00", ends_at: "2026-09-10T10:00:00+07:00" },
		],
	},
});
eq("create dengan sessions inline → 201", adminCreate.status, 201);
eq("dua sesi tersimpan", adminCreate.body?.data?.sessions?.length, 2);
eq("slug auto dari judul", adminCreate.body?.data?.slug, "rakor-dengan-runsheet");

const dupTitle = await h.req("/api/v1/admin/internal-events", {
	method: "POST",
	token: "tok-a-admin",
	json: { ...valid, title: "Rakor Dengan Runsheet" },
});
eq("judul sama → slug dapat sufiks, bukan 409", dupTitle.status, 201);
eq("slug diberi sufiks", dupTitle.body?.data?.slug, "rakor-dengan-runsheet-2");
const dupId = dupTitle.body?.data?.id as string;

// ── 7. Isolasi tulis lintas divisi ──────────────────────────────────────────
section("Isolasi tulis lintas divisi");

const crossUpdate = await h.req("/api/v1/admin/internal-events/ie-b-pub", {
	method: "PUT",
	token: "tok-a-admin",
	json: { title: "Diambil Alih A" },
});
eq("A update internal event B → 403", crossUpdate.status, 403);

const crossPublish = await h.req("/api/v1/admin/internal-events/ie-b-draft/publish", { method: "POST", token: "tok-a-admin" });
eq("A publish draft internal B → 403", crossPublish.status, 403);

const crossDelete = await h.req("/api/v1/admin/internal-events/ie-b-pub", { method: "DELETE", token: "tok-a-admin" });
eq("A delete internal event B → 403", crossDelete.status, 403);

const crossSession = await h.req("/api/v1/admin/internal-events/ie-b-pub/sessions", {
	method: "POST",
	token: "tok-a-admin",
	json: { name: "Sesi Sisipan", starts_at: S, ends_at: E },
});
eq("A tambah sesi ke internal event B → 403", crossSession.status, 403);

const crossSessionUpdate = await h.req("/api/v1/admin/internal-events/sessions/ies-b-1", {
	method: "PUT",
	token: "tok-a-admin",
	json: { name: "Sesi Dibajak" },
});
eq("A update sesi milik internal event B → 403", crossSessionUpdate.status, 403);

const crossSessionDelete = await h.req("/api/v1/admin/internal-events/sessions/ies-b-1", { method: "DELETE", token: "tok-a-admin" });
eq("A delete sesi milik internal event B → 403", crossSessionDelete.status, 403);

const hijack = await h.req("/api/v1/admin/internal-events", {
	token: "tok-a-admin",
	headers: { "X-Division-Id": DIVISIONS.b.id },
});
ok(
	"X-Division-Id divisi lain diabaikan — draft B tetap tidak muncul",
	!ids(hijack.body).includes("ie-b-draft"),
	ids(hijack.body),
);

const hijackWrite = await h.req("/api/v1/admin/internal-events/ie-b-pub", {
	method: "PUT",
	token: "tok-a-admin",
	headers: { "X-Division-Id": DIVISIONS.b.id },
	json: { title: "Lewat Header" },
});
eq("X-Division-Id tidak membuka tulis lintas divisi → 403", hijackWrite.status, 403);

const bphUpdateB = await h.req("/api/v1/admin/internal-events/ie-b-pub", {
	method: "PUT",
	token: "tok-bph",
	json: { title: "B Diubah BPH" },
});
eq("platform_admin boleh update internal event divisi B → 200", bphUpdateB.status, 200);
eq("judul benar-benar berubah", bphUpdateB.body?.data?.title, "B Diubah BPH");

// ── 8. Runsheet ─────────────────────────────────────────────────────────────
section("Runsheet");

const target = adminCreate.body?.data;
const sid1 = target.sessions[0].id as string;
const sid2 = target.sessions[1].id as string;
const targetId = target.id as string;

const addSession = await h.req(`/api/v1/admin/internal-events/${targetId}/sessions`, {
	method: "POST",
	token: "tok-a-admin",
	json: { name: "Penutup", starts_at: "2026-09-10T10:00:00+07:00", ends_at: "2026-09-10T11:00:00+07:00" },
});
eq("tambah sesi → 201", addSession.status, 201);
eq("sesi jadi tiga", addSession.body?.data?.sessions?.length, 3);
const sid3 = addSession.body?.data?.sessions?.[2]?.id as string;

const updSession = await h.req(`/api/v1/admin/internal-events/sessions/${sid1}`, {
	method: "PUT",
	token: "tok-a-admin",
	json: { name: "Pembukaan Direvisi" },
});
eq("update sesi → 200", updSession.status, 200);
eq(
	"nama sesi berubah",
	updSession.body?.data?.sessions?.find((s: any) => s.id === sid1)?.name,
	"Pembukaan Direvisi",
);

const reorder = await h.req(`/api/v1/admin/internal-events/${targetId}/sessions/order`, {
	method: "PUT",
	token: "tok-a-admin",
	json: { session_ids: [sid3, sid2, sid1] },
});
eq("reorder sesi → 200", reorder.status, 200);
eq(
	"urutan baru diterapkan",
	(reorder.body?.data?.sessions ?? []).map((s: any) => s.id),
	[sid3, sid2, sid1],
);

const reorderForeign = await h.req(`/api/v1/admin/internal-events/${targetId}/sessions/order`, {
	method: "PUT",
	token: "tok-a-admin",
	json: { session_ids: [sid1, "ies-b-1"] },
});
eq("reorder dengan id sesi event lain → 422", reorderForeign.status, 422);

const sessionOutOfRange = await h.req(`/api/v1/admin/internal-events/sessions/${sid1}`, {
	method: "PUT",
	token: "tok-a-admin",
	json: { starts_at: "2026-12-01T08:00:00+07:00", ends_at: "2026-12-01T09:00:00+07:00" },
});
eq("geser sesi ke luar rentang event → 422", sessionOutOfRange.status, 422);

const shrink = await h.req(`/api/v1/admin/internal-events/${targetId}`, {
	method: "PUT",
	token: "tok-a-admin",
	json: { starts_at: "2026-09-10T06:00:00+07:00", ends_at: "2026-09-10T07:00:00+07:00" },
});
eq("persempit rentang sampai sesi lama keluar → 422", shrink.status, 422);

const delSession = await h.req(`/api/v1/admin/internal-events/sessions/${sid3}`, { method: "DELETE", token: "tok-a-admin" });
eq("delete sesi → 200", delSession.status, 200);

const replaceAll = await h.req(`/api/v1/admin/internal-events/${targetId}`, {
	method: "PUT",
	token: "tok-a-admin",
	json: { sessions: [{ name: "Satu Sesi Saja", starts_at: "2026-09-10T08:00:00+07:00", ends_at: "2026-09-10T09:00:00+07:00" }] },
});
eq("kirim sessions → seluruh runsheet diganti", replaceAll.body?.data?.sessions?.length, 1);

// ── 9. Publish / unpublish ──────────────────────────────────────────────────
section("Publish & unpublish");

const publish = await h.req(`/api/v1/admin/internal-events/${contribId}/publish`, { method: "POST", token: "tok-a-admin" });
eq("division_admin publish draft divisinya → 200", publish.status, 200);
eq("status jadi published", publish.body?.data?.status, "published");

const listB = await h.req("/api/v1/admin/internal-events", { token: "tok-b-admin" });
ok(
	"setelah publish, divisi B ikut melihatnya (K-2)",
	ids(listB.body).includes(contribId),
	ids(listB.body),
);
ok("divisi B tetap tidak melihat draft A lainnya", !ids(listB.body).includes(forcedId), ids(listB.body));

const calAfterPublish = await h.req("/api/v1/admin/internal-events/calendar?month=2026-09", { token: "tok-b-admin" });
ok(
	"internal event A yang terbit masuk kalender divisi B",
	ids(calAfterPublish.body).includes(contribId),
	ids(calAfterPublish.body),
);

const unpublish = await h.req(`/api/v1/admin/internal-events/${contribId}/unpublish`, { method: "POST", token: "tok-a-admin" });
eq("unpublish → 200", unpublish.status, 200);
eq("status kembali draft", unpublish.body?.data?.status, "draft");

const listBAfter = await h.req("/api/v1/admin/internal-events", { token: "tok-b-admin" });
ok("setelah unpublish, divisi B tidak lagi melihatnya", !ids(listBAfter.body).includes(contribId));

// Event multi-hari melintasi batas bulan harus muncul di kedua bulan.
await seedInternalEvent(h, {
	id: "ie-span",
	slug: "ie-lintas-bulan",
	title: "Rakor Lintas Bulan",
	divisionId: DIVISIONS.a.id,
	status: "published",
	startsAt: "2026-09-29T08:00:00+07:00",
	endsAt: "2026-10-02T17:00:00+07:00",
});
const calSep = await h.req("/api/v1/admin/internal-events/calendar?month=2026-09", { token: "tok-a-admin" });
const calOct = await h.req("/api/v1/admin/internal-events/calendar?month=2026-10", { token: "tok-a-admin" });
ok("event lintas bulan muncul di September", ids(calSep.body).includes("ie-span"));
ok("event lintas bulan muncul di Oktober", ids(calOct.body).includes("ie-span"));

// ── 10. Audit log + hapus (D-U tidak diulang di modul ini) ──────────────────
section("Audit log & hapus");

const beforeCascade = await h.sql(
	`SELECT count(*) AS n FROM internal_event_sessions WHERE internal_event_id = ?`,
	targetId,
);
ok("runsheet ada sebelum event dihapus", Number(beforeCascade[0]?.n ?? 0) > 0, beforeCascade);

const deleted = await h.req(`/api/v1/admin/internal-events/${targetId}`, { method: "DELETE", token: "tok-a-admin" });
eq("delete internal event → 200", deleted.status, 200);

const gone = await h.req(`/api/v1/admin/internal-events/${targetId}`, { token: "tok-a-admin" });
eq("setelah dihapus → 404", gone.status, 404);

const afterCascade = await h.sql(
	`SELECT count(*) AS n FROM internal_event_sessions WHERE internal_event_id = ?`,
	targetId,
);
eq("sesi ikut ter-cascade saat event dihapus", Number(afterCascade[0]?.n ?? -1), 0);

const audit = await h.sql(
	`SELECT action FROM audit_logs WHERE resource_type IN ('internal_event','internal_session') ORDER BY created_at`,
);
const actions = audit.map((r: any) => r.action);
for (const expected of [
	"internal_events.create",
	"internal_events.update",
	"internal_events.publish",
	"internal_events.unpublish",
	"internal_events.delete",
	"internal_events.session_add",
	"internal_events.session_update",
	"internal_events.session_delete",
	"internal_events.session_reorder",
]) {
	ok(`audit mencatat ${expected}`, actions.includes(expected), actions);
}

const auditActor = await h.sql(
	`SELECT actor_email FROM audit_logs WHERE action = 'internal_events.create'`,
);
ok(
	"audit create mencatat actor contributor",
	auditActor.some((r: any) => r.actor_email === "contrib.a@example.com"),
	auditActor.map((r: any) => r.actor_email),
);

const auditCross = await h.sql(
	`SELECT actor_email, resource_id FROM audit_logs
	 WHERE action = 'internal_events.update' AND resource_id = 'ie-b-pub'`,
);
ok(
	"audit update lintas divisi mencatat actor platform_admin",
	auditCross.some((r: any) => r.actor_email === "bph@cakrawala.com"),
	auditCross,
);

// ─────────────────────────────────────────────────────────────────────────────

await h.dispose();

console.log("");
if (failed > 0) {
	console.error(`${failed} check GAGAL, ${passed} lolos`);
	console.error(`\nYang gagal:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
	process.exit(1);
}
console.log(`${passed} passed, ${failed} failed`);
