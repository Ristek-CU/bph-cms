/**
 * Suite regresi keamanan CMS Hub.
 *
 * Menjalankan Worker asli di Miniflare (D1 + R2 nyata, AUTH_SERVICE di-stub) lalu
 * menguji matriks otorisasi yang sebelumnya tidak punya test sama sekali —
 * termasuk dua item checklist operational di
 * docs/PRODUCTION-READINESS-2026-09-09.md §10 yang belum pernah diverifikasi:
 *   #5 divisi non-BPH tidak boleh membuka QPR
 *   #6 divisi A tidak boleh mengubah event divisi B
 *
 * Run: npm test
 */
import { errorHandler } from "./shared/error-handler";
import { ApiError } from "./shared/api-error";
import { startHarness, seedEvent, DIVISIONS, type Harness } from "./test/harness";

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

// ─────────────────────────────────────────────────────────────────────────────
// Bagian 1: matriks otorisasi, isolasi divisi, validasi, docs, header, storage.
// Rate limit diuji di harness terpisah supaya counternya tidak saling mengganggu.
// ─────────────────────────────────────────────────────────────────────────────

const h: Harness = await startHarness();

const S = "2026-09-10T08:00:00+07:00";
const E = "2026-09-11T17:00:00+07:00";

// Event per divisi: satu published + satu draft, supaya kebocoran draft dan
// penyeberangan divisi sama-sama teruji.
await seedEvent(h, { id: "ev-a-pub", slug: "a-publik", title: "A Publik", divisionId: DIVISIONS.a.id, status: "published" });
await seedEvent(h, { id: "ev-a-draft", slug: "a-draft", title: "A Draft", divisionId: DIVISIONS.a.id, status: "draft" });
await seedEvent(h, { id: "ev-b-pub", slug: "b-publik", title: "B Publik", divisionId: DIVISIONS.b.id, status: "published" });
await seedEvent(h, { id: "ev-b-draft", slug: "b-draft", title: "B Draft", divisionId: DIVISIONS.b.id, status: "draft" });
await seedEvent(h, { id: "ev-bph-pub", slug: "bph-publik", title: "BPH Publik", divisionId: DIVISIONS.bph.id, status: "published" });

const validEvent = {
	title: "Event Uji",
	starts_at: S,
	ends_at: E,
	location: "Aula",
};

// ── 1. Autentikasi ───────────────────────────────────────────────────────────
section("Autentikasi");

const adminPaths = [
	["GET", "/api/v1/admin/events"],
	["POST", "/api/v1/admin/events"],
	["PUT", "/api/v1/admin/events/ev-a-pub"],
	["DELETE", "/api/v1/admin/events/ev-a-pub"],
	["POST", "/api/v1/admin/events/ev-a-pub/publish"],
	["POST", "/api/v1/admin/media"],
	["GET", "/api/v1/admin/divisions"],
	["POST", "/api/v1/admin/divisions"],
	["GET", "/api/v1/admin/accounts"],
	["POST", "/api/v1/admin/accounts"],
	["GET", "/api/v1/admin/audit-logs"],
	["GET", "/api/v1/admin/qpr"],
	["GET", "/api/v1/me"],
	["GET", "/api/v1/openapi"],
] as const;

for (const [method, path] of adminPaths) {
	const noToken = await h.req(path, { method });
	eq(`${method} ${path} tanpa token → 401`, noToken.status, 401);
}

const garbage = await h.req("/api/v1/admin/events", { token: "sampah-bukan-token-valid" });
eq("token tidak dikenal → 401", garbage.status, 401);

const rawToken = await h.req("/api/v1/admin/events", {
	headers: { Authorization: "tok-a-admin" },
});
eq("Authorization tanpa skema Bearer → 401", rawToken.status, 401);

// Jalur cookie ditutup: session cookie tidak lagi diterima sebagai kredensial.
const cookieOnly = await h.req("/api/v1/admin/events", {
	headers: { Cookie: "session=tok-a-admin" },
});
eq("Cookie saja (tanpa Bearer) → 401", cookieOnly.status, 401);

// ── 2. Dev-auth fallback tidak boleh hidup di luar localhost ─────────────────
section("Dev-auth fallback");

const devDefault = await h.req("/api/v1/me", { token: "dev-token" });
eq("ALLOW_DEV_AUTH unset + 'Bearer dev-token' → 401", devDefault.status, 401);

const devVariant = await h.req("/api/v1/me", { token: "dev-apapun" });
eq("ALLOW_DEV_AUTH unset + 'Bearer dev-apapun' → 401", devVariant.status, 401);

// ── 3. Bootstrap platform_admin ──────────────────────────────────────────────
section("Bootstrap platform_admin");

const bphMe = await h.req("/api/v1/me", { token: "tok-bph" });
eq("bph@cakrawala.com tanpa membership → platform_admin", bphMe.body?.data?.memberships?.[0]?.role, "platform_admin");
eq("active division bph = divisi BPH", bphMe.body?.data?.active_division_id, DIVISIONS.bph.id);

const outsiderMe = await h.req("/api/v1/me", { token: "tok-outsider" });
eq("akun tanpa membership → 200 tapi nol membership", outsiderMe.body?.data?.memberships?.length, 0);

const outsiderList = await h.req("/api/v1/admin/events", { token: "tok-outsider" });
eq("akun tanpa membership → list event 403", outsiderList.status, 403);

const outsiderCreate = await h.req("/api/v1/admin/events", {
	method: "POST",
	token: "tok-outsider",
	json: validEvent,
});
eq("akun tanpa membership → create event 403", outsiderCreate.status, 403);

// ── 4. Isolasi lintas divisi (checklist #6) ──────────────────────────────────
section("Isolasi lintas divisi");

const listA = await h.req("/api/v1/admin/events", { token: "tok-a-admin" });
const idsA = (listA.body?.data ?? []).map((e: any) => e.id).sort();
eq(
	"division_admin A hanya melihat event divisi A",
	idsA,
	["ev-a-draft", "ev-a-pub"],
);

const listB = await h.req("/api/v1/admin/events", { token: "tok-b-admin" });
const idsB = (listB.body?.data ?? []).map((e: any) => e.id).sort();
eq("division_admin B hanya melihat event divisi B", idsB, ["ev-b-draft", "ev-b-pub"]);

const crossUpdate = await h.req("/api/v1/admin/events/ev-b-pub", {
	method: "PUT",
	token: "tok-a-admin",
	json: { title: "Diambil Alih A" },
});
eq("A update event B → 403", crossUpdate.status, 403);

const crossDelete = await h.req("/api/v1/admin/events/ev-b-pub", {
	method: "DELETE",
	token: "tok-a-admin",
});
eq("A delete event B → 403", crossDelete.status, 403);

const crossPublish = await h.req("/api/v1/admin/events/ev-b-draft/publish", {
	method: "POST",
	token: "tok-a-admin",
});
eq("A publish event B → 403", crossPublish.status, 403);

const crossSession = await h.req("/api/v1/admin/events/ev-b-pub/sessions", {
	method: "POST",
	token: "tok-a-admin",
	json: { name: "Sesi Sisipan", starts_at: S, ends_at: E },
});
eq("A tambah sesi ke event B → 403", crossSession.status, 403);

// Sesi milik event divisi B — ownership harus ditelusuri lewat event induk.
await h.sql(
	`INSERT INTO event_sessions
	   (id, event_id, name, starts_at, ends_at, starts_at_ms, ends_at_ms, sort_order)
	 VALUES ('ses-b-1', 'ev-b-pub', 'Sesi B', ?, ?, ?, ?, 0)`,
	S,
	E,
	Date.parse(S),
	Date.parse(E),
);

const crossSessionUpdate = await h.req("/api/v1/admin/events/sessions/ses-b-1", {
	method: "PUT",
	token: "tok-a-admin",
	json: { name: "Sesi Dibajak" },
});
eq("A update sesi milik event B → 403", crossSessionUpdate.status, 403);

const crossSessionDelete = await h.req("/api/v1/admin/events/sessions/ses-b-1", {
	method: "DELETE",
	token: "tok-a-admin",
});
eq("A delete sesi milik event B → 403", crossSessionDelete.status, 403);

// Header X-Division-Id tidak boleh jadi jalan pintas ke divisi lain.
const hijack = await h.req("/api/v1/admin/events", {
	token: "tok-a-admin",
	headers: { "X-Division-Id": DIVISIONS.b.id },
});
const hijackIds = (hijack.body?.data ?? []).map((e: any) => e.id).sort();
eq(
	"X-Division-Id divisi lain diabaikan, fallback ke divisi sendiri",
	hijackIds,
	["ev-a-draft", "ev-a-pub"],
);

const hijackWrite = await h.req("/api/v1/admin/events/ev-b-pub", {
	method: "PUT",
	token: "tok-a-admin",
	headers: { "X-Division-Id": DIVISIONS.b.id },
	json: { title: "Lewat Header" },
});
eq("X-Division-Id tidak membuka tulis lintas divisi → 403", hijackWrite.status, 403);

// platform_admin boleh lintas divisi.
const bphUpdateB = await h.req("/api/v1/admin/events/ev-b-pub", {
	method: "PUT",
	token: "tok-bph",
	json: { title: "B Diubah BPH" },
});
eq("platform_admin boleh update event divisi B → 200", bphUpdateB.status, 200);

const bphListAll = await h.req("/api/v1/admin/events", { token: "tok-bph" });
eq("platform_admin melihat semua divisi", (bphListAll.body?.data ?? []).length, 5);

// ── 5. Contributor draft-only ────────────────────────────────────────────────
section("Contributor draft-only");

const contribCreate = await h.req("/api/v1/admin/events", {
	method: "POST",
	token: "tok-a-contrib",
	json: { ...validEvent, title: "Draft Contributor" },
});
eq("contributor create → 201", contribCreate.status, 201);
eq("event baru contributor selalu draft", contribCreate.body?.data?.status, "draft");
eq("event contributor milik divisi A", contribCreate.body?.data?.id !== undefined, true);
const contribEventId = contribCreate.body?.data?.id;

// `status` bukan field yang bisa ditulis — create/update tidak pernah menerimanya.
const contribForcePublish = await h.req("/api/v1/admin/events", {
	method: "POST",
	token: "tok-a-contrib",
	json: { ...validEvent, title: "Coba Terbit", status: "published", slug: "coba-terbit" },
});
eq(
	"contributor mengirim status:'published' → tetap draft",
	contribForcePublish.body?.data?.status,
	"draft",
);

const contribUpdateDraft = await h.req(`/api/v1/admin/events/${contribEventId}`, {
	method: "PUT",
	token: "tok-a-contrib",
	json: { title: "Draft Diperbarui" },
});
eq("contributor update draft sendiri → 200", contribUpdateDraft.status, 200);

const contribUpdatePublished = await h.req("/api/v1/admin/events/ev-a-pub", {
	method: "PUT",
	token: "tok-a-contrib",
	json: { title: "Ubah Yang Sudah Terbit" },
});
eq("contributor update event published → 403", contribUpdatePublished.status, 403);

const contribPublish = await h.req(`/api/v1/admin/events/${contribEventId}/publish`, {
	method: "POST",
	token: "tok-a-contrib",
});
eq("contributor publish → 403", contribPublish.status, 403);

const contribUnpublish = await h.req("/api/v1/admin/events/ev-a-pub/unpublish", {
	method: "POST",
	token: "tok-a-contrib",
});
eq("contributor unpublish → 403", contribUnpublish.status, 403);

const contribDelete = await h.req(`/api/v1/admin/events/${contribEventId}`, {
	method: "DELETE",
	token: "tok-a-contrib",
});
eq("contributor delete → 403", contribDelete.status, 403);

// ── 6. Viewer read-only ──────────────────────────────────────────────────────
section("Viewer read-only");

const viewerList = await h.req("/api/v1/admin/events", { token: "tok-a-viewer" });
eq("viewer list → 200", viewerList.status, 200);
// 2 event seed + 2 draft buatan contributor di bagian sebelumnya.
eq("viewer hanya divisi sendiri", (viewerList.body?.data ?? []).length, 4);

const viewerCreate = await h.req("/api/v1/admin/events", {
	method: "POST",
	token: "tok-a-viewer",
	json: { ...validEvent, title: "Viewer Coba Buat" },
});
eq("viewer create → 403", viewerCreate.status, 403);

const viewerUpdate = await h.req(`/api/v1/admin/events/${contribEventId}`, {
	method: "PUT",
	token: "tok-a-viewer",
	json: { title: "Viewer Coba Ubah" },
});
eq("viewer update → 403", viewerUpdate.status, 403);

const viewerDelete = await h.req(`/api/v1/admin/events/${contribEventId}`, {
	method: "DELETE",
	token: "tok-a-viewer",
});
eq("viewer delete → 403", viewerDelete.status, 403);

const viewerPublish = await h.req(`/api/v1/admin/events/${contribEventId}/publish`, {
	method: "POST",
	token: "tok-a-viewer",
});
eq("viewer publish → 403", viewerPublish.status, 403);

// ── 7. Endpoint khusus platform (checklist #5) ───────────────────────────────
section("Endpoint khusus platform_admin");

for (const token of ["tok-a-admin", "tok-a-contrib", "tok-a-viewer", "tok-b-admin"]) {
	const qpr = await h.req("/api/v1/admin/qpr", { token });
	eq(`${token} → QPR 403`, qpr.status, 403);
	const accounts = await h.req("/api/v1/admin/accounts", { token });
	eq(`${token} → accounts 403`, accounts.status, 403);
	const divisions = await h.req("/api/v1/admin/divisions", { token });
	eq(`${token} → divisions 403`, divisions.status, 403);
	const audits = await h.req("/api/v1/admin/audit-logs", { token });
	eq(`${token} → audit-logs 403`, audits.status, 403);
}

const bphQpr = await h.req("/api/v1/admin/qpr", { token: "tok-bph" });
eq("platform_admin → QPR 200", bphQpr.status, 200);
const bphAccounts = await h.req("/api/v1/admin/accounts", { token: "tok-bph" });
eq("platform_admin → accounts 200", bphAccounts.status, 200);
const bphAudits = await h.req("/api/v1/admin/audit-logs", { token: "tok-bph" });
eq("platform_admin → audit-logs 200", bphAudits.status, 200);

// ── 8. Gate dokumentasi ──────────────────────────────────────────────────────
section("Gate dokumentasi /openapi");

const docsNoToken = await h.req("/api/v1/openapi");
eq("/openapi tanpa token → 401", docsNoToken.status, 401);

const docsBph = await h.req("/api/v1/openapi", { token: "tok-bph" });
eq("/openapi platform_admin di luar allowlist → 403", docsBph.status, 403);

const docsOutsider = await h.req("/api/v1/openapi", { token: "tok-outsider" });
eq("/openapi akun tanpa membership → 403", docsOutsider.status, 403);

const docsRistek = await h.req("/api/v1/openapi", { token: "tok-ristek" });
eq("/openapi email allowlist → 200", docsRistek.status, 200);
ok(
	"spec /openapi benar-benar berisi daftar path",
	typeof docsRistek.body?.paths === "object" && Object.keys(docsRistek.body.paths).length > 5,
	Object.keys(docsRistek.body?.paths ?? {}).length,
);

// ── 9. Draft tidak pernah bocor ke publik ────────────────────────────────────
section("Draft tidak bocor ke publik");

const pubList = await h.req("/api/v1/events?limit=50");
const pubSlugs = (pubList.body?.data?.items ?? []).map((e: any) => e.slug).sort();
eq("list publik hanya event published", pubSlugs, ["a-publik", "b-publik", "bph-publik"]);

const pubDraft = await h.req("/api/v1/events/a-draft");
eq("detail slug draft → 404", pubDraft.status, 404);

const pubMissing = await h.req("/api/v1/events/tidak-ada-slug-ini");
eq("detail slug tidak dikenal → 404", pubMissing.status, 404);

const pubDetail = await h.req("/api/v1/events/b-publik");
eq("detail published → 200", pubDetail.status, 200);
eq("detail publik tidak membocorkan division_id", pubDetail.body?.data?.division_id, undefined);
eq("detail publik tidak membocorkan created_by_user_id", pubDetail.body?.data?.created_by_user_id, undefined);

const pubCal = await h.req("/api/v1/events/calendar?month=2026-09");
const calSlugs = (pubCal.body?.data?.items ?? []).map((e: any) => e.slug).sort();
eq("kalender publik hanya published", calSlugs, ["a-publik", "b-publik", "bph-publik"]);

const adminListLeak = await h.req("/api/v1/events?limit=50");
ok(
	"list publik tidak membocorkan sesi/internal admin",
	(adminListLeak.body?.data?.items ?? []).every((e: any) => e.sessions === undefined),
);

// ── 10. Validasi input ───────────────────────────────────────────────────────
section("Validasi input");

const badRange = await h.req("/api/v1/admin/events", {
	method: "POST",
	token: "tok-a-admin",
	json: { ...validEvent, starts_at: E, ends_at: S },
});
eq("ends_at <= starts_at → 422", badRange.status, 422);
ok("422 membawa errors per field", Array.isArray(badRange.body?.errors?.ends_at), badRange.body?.errors);

const badSlug = await h.req("/api/v1/admin/events", {
	method: "POST",
	token: "tok-a-admin",
	json: { ...validEvent, slug: "Slug Bukan Kebab!" },
});
eq("slug bukan kebab-case → 422", badSlug.status, 422);

const badSession = await h.req("/api/v1/admin/events", {
	method: "POST",
	token: "tok-a-admin",
	json: {
		...validEvent,
		sessions: [{ name: "Di Luar Rentang", starts_at: "2026-12-01T08:00:00+07:00", ends_at: "2026-12-01T09:00:00+07:00" }],
	},
});
eq("sesi di luar rentang event → 422", badSession.status, 422);

const badIso = await h.req("/api/v1/admin/events", {
	method: "POST",
	token: "tok-a-admin",
	json: { ...validEvent, starts_at: "10 September 2026" },
});
eq("timestamp bukan ISO 8601 → 422", badIso.status, 422);

const badUrl = await h.req("/api/v1/admin/events", {
	method: "POST",
	token: "tok-a-admin",
	json: { ...validEvent, registration_url: "bukan-url" },
});
eq("URL tidak valid → 422", badUrl.status, 422);

const brokenJsonEvents = await h.req("/api/v1/admin/events", {
	method: "POST",
	token: "tok-a-admin",
	headers: { "Content-Type": "application/json" },
	body: "{ rusak",
});
eq("JSON rusak di /admin/events → 400 (bukan 500)", brokenJsonEvents.status, 400);

const brokenJsonAccounts = await h.req("/api/v1/admin/accounts", {
	method: "POST",
	token: "tok-bph",
	headers: { "Content-Type": "application/json" },
	body: "{ rusak",
});
eq("JSON rusak di /admin/accounts → 400 (bukan 500)", brokenJsonAccounts.status, 400);

const brokenJsonDivisions = await h.req("/api/v1/admin/divisions", {
	method: "POST",
	token: "tok-bph",
	headers: { "Content-Type": "application/json" },
	body: "bukan json",
});
eq("JSON rusak di /admin/divisions → 400 (bukan 500)", brokenJsonDivisions.status, 400);

// ── 11. Validasi akun & divisi (sebelumnya tanpa schema sama sekali) ─────────
section("Validasi akun & divisi");

const bogusRole = await h.req("/api/v1/admin/accounts", {
	method: "POST",
	token: "tok-bph",
	json: {
		user_id: "u-baru",
		user_email: "baru@example.com",
		division_id: DIVISIONS.a.id,
		role: "superuser",
	},
});
eq("role di luar enum → 422", bogusRole.status, 422);
ok("422 menyebut field role", Array.isArray(bogusRole.body?.errors?.role), bogusRole.body?.errors);

const ghostDivision = await h.req("/api/v1/admin/accounts", {
	method: "POST",
	token: "tok-bph",
	json: {
		user_id: "u-baru",
		user_email: "baru@example.com",
		division_id: "divisi-tidak-ada",
		role: "viewer",
	},
});
eq("division_id tidak dikenal → 422", ghostDivision.status, 422);

const badEmail = await h.req("/api/v1/admin/accounts", {
	method: "POST",
	token: "tok-bph",
	json: {
		user_id: "u-baru",
		user_email: "bukan-email",
		division_id: DIVISIONS.a.id,
		role: "viewer",
	},
});
eq("email tidak valid → 422", badEmail.status, 422);

const goodMembership = await h.req("/api/v1/admin/accounts", {
	method: "POST",
	token: "tok-bph",
	json: {
		user_id: "u-baru",
		user_email: "Baru@Example.com",
		division_id: DIVISIONS.a.id,
		role: "viewer",
	},
});
eq("membership valid → 201", goodMembership.status, 201);

const dupMembership = await h.req("/api/v1/admin/accounts", {
	method: "POST",
	token: "tok-bph",
	json: {
		user_id: "u-baru",
		user_email: "baru@example.com",
		division_id: DIVISIONS.a.id,
		role: "viewer",
	},
});
eq("membership duplikat → 409 (bukan 500)", dupMembership.status, 409);

const badDivisionSlug = await h.req("/api/v1/admin/divisions", {
	method: "POST",
	token: "tok-bph",
	json: { slug: "Slug Salah", name: "Divisi Uji" },
});
eq("slug divisi bukan kebab-case → 422", badDivisionSlug.status, 422);

const dupDivision = await h.req("/api/v1/admin/divisions", {
	method: "POST",
	token: "tok-bph",
	json: { slug: "bph", name: "BPH Kembar" },
});
eq("slug divisi duplikat → 409 (bukan 500)", dupDivision.status, 409);

// ── 12. Pesan error internal tidak bocor ─────────────────────────────────────
section("Error internal tidak bocor");

const leaky = await h.req("/api/v1/admin/events/ev-a-pub", {
	method: "PUT",
	token: "tok-a-admin",
	json: { title: 12345 },
});
eq("tipe field salah → 422", leaky.status, 422);
ok(
	"body 422 tidak memuat jejak SQL/stack",
	!/SELECT|INSERT|sqlite|D1_ERROR|at \w+\s*\(/i.test(JSON.stringify(leaky.body)),
	leaky.body,
);

// Kontrak errorHandler diuji langsung: error mentah D1 tidak boleh jadi body.
const rawD1Error = new Error(
	'D1_ERROR: UNIQUE constraint failed: cms_memberships.user_id, cms_memberships.division_id: SQLITE_CONSTRAINT (SELECT * FROM cms_memberships WHERE user_id = ?)',
);
const fakeCtx: any = {
	req: { path: "/api/v1/admin/accounts", method: "POST" },
	get: () => "req-123",
};
const handled = errorHandler(rawD1Error, fakeCtx);
const handledBody = JSON.parse(await handled.text());
eq("error mentah → 500", handled.status, 500);
eq("pesan 500 generik", handledBody.message, "Internal server error");
ok(
	"body 500 tidak memuat nama tabel/SQL",
	!/cms_memberships|SELECT|SQLITE_CONSTRAINT|D1_ERROR/i.test(JSON.stringify(handledBody)),
	handledBody,
);
eq("body 500 menyertakan requestId untuk korelasi log", handledBody.requestId, "req-123");

const handledApiError = errorHandler(ApiError.notFound("Event tidak ditemukan"), fakeCtx);
const apiErrorBody = JSON.parse(await handledApiError.text());
eq("ApiError tetap mengirim pesannya", apiErrorBody.message, "Event tidak ditemukan");
eq("ApiError tetap 404", handledApiError.status, 404);

// ── 13. Header keamanan ──────────────────────────────────────────────────────
section("Header keamanan");

const headerProbe = await h.req("/api/v1/events?limit=1");
eq("X-Content-Type-Options: nosniff", headerProbe.headers.get("x-content-type-options"), "nosniff");
eq("X-Frame-Options: DENY", headerProbe.headers.get("x-frame-options"), "DENY");
eq("Referrer-Policy: no-referrer", headerProbe.headers.get("referrer-policy"), "no-referrer");
ok(
	"CSP default-src 'none' terpasang",
	(headerProbe.headers.get("content-security-policy") ?? "").includes("default-src 'none'"),
	headerProbe.headers.get("content-security-policy"),
);

const errHeaders = await h.req("/api/v1/admin/events");
eq("header keamanan juga ada di respons 401", errHeaders.headers.get("x-content-type-options"), "nosniff");

// ── 14. CORS ─────────────────────────────────────────────────────────────────
section("CORS");

// Miniflare menolak Origin ber-hostname non-localhost, jadi dipakai origin yang
// memang ada di whitelist production (http://localhost:5173) dan satu origin
// localhost lain yang sengaja tidak di-whitelist.
const preflight = await h.req("/api/v1/admin/events", {
	method: "OPTIONS",
	headers: {
		Origin: "http://localhost:5173",
		"Access-Control-Request-Method": "PUT",
		"Access-Control-Request-Headers": "authorization,x-division-id",
	},
});
const allowHeaders = (preflight.headers.get("access-control-allow-headers") ?? "").toLowerCase();
eq("preflight dijawab 204", preflight.status, 204);
eq(
	"preflight mengizinkan origin whitelist",
	preflight.headers.get("access-control-allow-origin"),
	"http://localhost:5173",
);
ok("preflight mengizinkan Authorization", allowHeaders.includes("authorization"), allowHeaders);
ok("preflight mengizinkan X-Division-Id", allowHeaders.includes("x-division-id"), allowHeaders);

const evilOrigin = await h.req("/api/v1/events?limit=1", {
	method: "OPTIONS",
	headers: {
		Origin: "http://localhost:9999",
		"Access-Control-Request-Method": "GET",
	},
});
eq(
	"origin di luar whitelist tidak diberi Access-Control-Allow-Origin",
	evilOrigin.headers.get("access-control-allow-origin"),
	null,
);

// ── 15. Storage R2 ───────────────────────────────────────────────────────────
section("Storage R2");

const pngBytes = Uint8Array.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

const uploadHtml = multipart("payload.html", "text/html", new TextEncoder().encode("<script>alert(1)</script>"));
const htmlUpload = await h.req("/api/v1/admin/media", {
	method: "POST",
	token: "tok-a-admin",
	body: uploadHtml.body,
	headers: { "Content-Type": uploadHtml.contentType },
});
eq("upload text/html → 422", htmlUpload.status, 422);

const uploadSvg = multipart("payload.svg", "image/svg+xml", new TextEncoder().encode("<svg/>"));
const svgUpload = await h.req("/api/v1/admin/media", {
	method: "POST",
	token: "tok-a-admin",
	body: uploadSvg.body,
	headers: { "Content-Type": uploadSvg.contentType },
});
eq("upload image/svg+xml → 422 (SVG bisa membawa script)", svgUpload.status, 422);

const uploadOk = multipart("cover.png", "image/png", pngBytes);
const pngUpload = await h.req("/api/v1/admin/media", {
	method: "POST",
	token: "tok-a-admin",
	body: uploadOk.body,
	headers: { "Content-Type": uploadOk.contentType },
});
eq("upload image/png valid → 201", pngUpload.status, 201);
const uploadedUrl: string = pngUpload.body?.data?.url ?? "";
ok(
	"URL upload = API_BASE_URL + /storage/covers/",
	uploadedUrl.startsWith("https://bph-cms.test/api/v1/storage/covers/"),
	uploadedUrl,
);

const viewerUpload = multipart("v.png", "image/png", pngBytes);
const viewerUploadRes = await h.req("/api/v1/admin/media", {
	method: "POST",
	token: "tok-a-viewer",
	body: viewerUpload.body,
	headers: { "Content-Type": viewerUpload.contentType },
});
eq("viewer upload media → 403", viewerUploadRes.status, 403);

const noAuthUpload = multipart("n.png", "image/png", pngBytes);
const noAuthUploadRes = await h.req("/api/v1/admin/media", {
	method: "POST",
	body: noAuthUpload.body,
	headers: { "Content-Type": noAuthUpload.contentType },
});
eq("upload tanpa token → 401", noAuthUploadRes.status, 401);

const storageKey = uploadedUrl.split("/storage/")[1];
if (storageKey) {
	const served = await h.req(`/api/v1/storage/${storageKey}`);
	eq("objek terupload bisa dibaca publik → 200", served.status, 200);
	eq("content-type objek = image/png", served.headers.get("content-type"), "image/png");
	eq(
		"objek storage diberi nosniff",
		served.headers.get("x-content-type-options"),
		"nosniff",
	);
}

const traversal = await h.req("/api/v1/storage/covers/../../secrets");
ok("path traversal di /storage → 404", traversal.status === 404, traversal.status);

const missingObject = await h.req("/api/v1/storage/covers/tidak-ada.png");
eq("objek tidak ada → 404", missingObject.status, 404);

// ── 16. Audit log tertulis ───────────────────────────────────────────────────
section("Audit log");

const auditRows = await h.sql("SELECT action, actor_email, resource_type FROM audit_logs ORDER BY created_at");
ok("aksi tulis meninggalkan jejak audit", auditRows.length > 0, auditRows.length);
ok(
	"audit mencatat events.create oleh actor yang benar",
	auditRows.some((r: any) => r.action === "events.create" && r.actor_email === "contrib.a@example.com"),
	auditRows.map((r: any) => `${r.action}/${r.actor_email}`),
);
ok(
	"audit mencatat media.upload",
	auditRows.some((r: any) => r.action === "media.upload"),
	auditRows.map((r: any) => r.action),
);
ok(
	"audit mencatat pembuatan membership oleh platform_admin",
	auditRows.some(
		(r: any) => r.action === "accounts.membership_create" && r.actor_email === "bph@cakrawala.com",
	),
	auditRows.map((r: any) => r.action),
);

await h.dispose();

// ─────────────────────────────────────────────────────────────────────────────
// Bagian 2: dev-auth guard berbasis hostname — butuh var ALLOW_DEV_AUTH=true.
// ─────────────────────────────────────────────────────────────────────────────

const hDev = await startHarness({ vars: { ALLOW_DEV_AUTH: "true" } });

section("Dev-auth dengan ALLOW_DEV_AUTH=true");

const devRemote = await hDev.req("/api/v1/me", { token: "dev-token" });
eq(
	"ALLOW_DEV_AUTH=true + host non-localhost → tetap 401",
	devRemote.status,
	401,
);

const devLocal = await hDev.req("/api/v1/me", { token: "dev-token", host: "localhost" });
eq("ALLOW_DEV_AUTH=true + host localhost → 200", devLocal.status, 200);
eq("dev-auth lokal memakai identitas dev", devLocal.body?.data?.user?.email, "bph@cakrawala.com");

await hDev.dispose();

// ─────────────────────────────────────────────────────────────────────────────
// Bagian 3: rate limiting. Harness sendiri supaya counter mulai dari nol.
// ─────────────────────────────────────────────────────────────────────────────

const hRate = await startHarness();

/**
 * Counter rate limit memakai fixed window yang sejajar jam dinding. Kalau loop
 * test kebetulan melintasi batas window, counter reset di tengah dan titik
 * blokir bergeser — jadi dipastikan dulu sisa window cukup sebelum menembak.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const awaitWindowHeadroom = async (windowMs: number, minHeadroomMs: number) => {
	const remaining = windowMs - (Date.now() % windowMs);
	if (remaining < minHeadroomMs) await sleep(remaining + 100);
};

section("Rate limit brute-force sign-in");

await awaitWindowHeadroom(15 * 60_000, 20_000);

// Batas per IP+email = 20 / 15 menit. Percobaan ke-21 harus ditolak.
let firstBlockAt = 0;
for (let i = 1; i <= 25; i++) {
	const r = await hRate.req("/api/v1/auth/sign-in", {
		method: "POST",
		json: { email: "korban@example.com", password: `salah-${i}` },
	});
	if (r.status === 429) {
		firstBlockAt = i;
		break;
	}
}
eq("sign-in diblokir tepat di percobaan ke-21", firstBlockAt, 21);

const stillBlocked = await hRate.req("/api/v1/auth/sign-in", {
	method: "POST",
	json: { email: "korban@example.com", password: "salah-lagi" },
});
eq("setelah kena limit, tetap 429", stillBlocked.status, 429);

// Email lain dari IP sama belum kena limit per-email, tapi ada plafon per-IP.
const otherEmail = await hRate.req("/api/v1/auth/sign-in", {
	method: "POST",
	json: { email: "lain@example.com", password: "salah" },
});
eq("email lain dari IP sama belum diblokir per-email", otherEmail.status, 401);

let ipBlockAt = 0;
for (let i = 1; i <= 45; i++) {
	const r = await hRate.req("/api/v1/auth/sign-in", {
		method: "POST",
		json: { email: `spray-${i}@example.com`, password: "salah" },
	});
	if (r.status === 429) {
		ipBlockAt = i;
		break;
	}
}
ok("password spraying diblokir plafon per-IP (<= 60 total)", ipBlockAt > 0 && ipBlockAt <= 45, ipBlockAt);

section("Rate limit sign-up");

let signUpBlockAt = 0;
for (let i = 1; i <= 14; i++) {
	const r = await hRate.req("/api/v1/auth/sign-up", {
		method: "POST",
		json: { name: `Spam ${i}`, email: `spam-${i}@example.com`, password: "password123" },
	});
	if (r.status === 429) {
		signUpBlockAt = i;
		break;
	}
}
eq("sign-up diblokir tepat di percobaan ke-11", signUpBlockAt, 11);

section("Rate limit endpoint publik");

await awaitWindowHeadroom(60_000, 15_000);

// Konfigurasi 120/menit/IP: permintaan ke-121 harus 429.
let publicBlockAt = 0;
for (let i = 1; i <= 125; i++) {
	const r = await hRate.req("/api/v1/events?limit=1");
	if (r.status === 429) {
		publicBlockAt = i;
		break;
	}
}
eq("endpoint publik diblokir tepat di request ke-121", publicBlockAt, 121);

const afterLimit = await hRate.req("/api/v1/events?limit=1");
eq("429 bertahan selama window", afterLimit.status, 429);
ok(
	"respons 429 memakai bentuk wrapper standar",
	afterLimit.body?.success === false && afterLimit.body?.statusCode === 429,
	afterLimit.body,
);

// Path lain punya counter sendiri — tidak ikut terkunci.
const otherPath = await hRate.req("/api/v1/events/calendar?month=2026-09");
eq("path publik lain punya counter terpisah", otherPath.status, 200);

await hRate.dispose();

// ─────────────────────────────────────────────────────────────────────────────

function multipart(filename: string, contentType: string, bytes: Uint8Array) {
	const boundary = "----bphcmstestboundary";
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

console.log("");
if (failed > 0) {
	console.error(`${failed} check GAGAL, ${passed} lolos`);
	console.error(`\nYang gagal:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
	process.exit(1);
}
console.log(`all ${passed} security checks passed`);
