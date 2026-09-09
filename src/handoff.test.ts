/**
 * Self-check SSO handoff antar dashboard (SDD §4.5, tugas T7).
 *
 * Menjalankan Worker asli di Miniflare (D1 nyata, AUTH_SERVICE di-stub) dan menguji:
 * kode sekali pakai, kode kadaluarsa, isolasi lintas divisi, penolakan pemanggil
 * internal yang tidak punya shared secret, filter is_active di /api/v1/me, dan
 * bahwa redirect_to tidak membawa token.
 *
 * Shared secret disuntik lewat startHarness({ vars }) — harness tidak diubah.
 *
 * Run: npm test
 */
import { startHarness, DIVISIONS, type Harness } from "./test/harness";

const SECRET = "handoff-test-secret";

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

const h: Harness = await startHarness({ vars: { HANDOFF_SHARED_SECRET: SECRET } });

// Workspace eksternal milik divisi A (Ristek) dan milik divisi lain (Advokasi).
const wsRows = await h.sql(
	`SELECT id, division_id, kind, url, is_active FROM workspace_options WHERE kind = 'external_dashboard'`,
);
const extA = wsRows.find((r: any) => r.division_id === DIVISIONS.a.id);
const extOther = wsRows.find((r: any) => r.division_id !== DIVISIONS.a.id);
const hubA = (
	await h.sql(`SELECT id FROM workspace_options WHERE kind = 'cms_hub' AND division_id = ?`, DIVISIONS.a.id)
)[0];

ok("seed: workspace eksternal divisi A ada", Boolean(extA), wsRows);
ok("seed: workspace eksternal divisi lain ada", Boolean(extOther), wsRows);

const createHandoff = (token: string, workspaceId: string) =>
	h.req("/api/v1/admin/workspace-handoff", {
		method: "POST",
		token,
		json: { workspace_option_id: workspaceId },
	});

const exchange = (code: string, secret?: string) =>
	h.req("/api/v1/internal/handoff/exchange", {
		method: "POST",
		json: { code },
		...(secret === undefined ? {} : { headers: { "X-Handoff-Secret": secret } }),
	});

// ── Pembuatan kode ───────────────────────────────────────────────────────────
section("Pembuatan kode handoff");

const noToken = await createHandoff("", extA.id);
eq("tanpa token → 401", noToken.status, 401);

const created = await createHandoff("tok-a-admin", extA.id);
eq("member divisi pemilik → 200", created.status, 200);
const redirectTo: string = created.body?.data?.redirect_to ?? "";
ok("redirect_to menuju <ws.url>/sso?code=", redirectTo.startsWith(`${extA.url}/sso?code=`), redirectTo);

const redirectUrl = new URL(redirectTo);
eq("redirect_to hanya membawa param code", [...redirectUrl.searchParams.keys()], ["code"]);
ok(
	"redirect_to tidak membawa token/session",
	!redirectUrl.search.includes("token") && !redirectTo.includes("Bearer"),
	redirectTo,
);
const code = redirectUrl.searchParams.get("code") ?? "";
ok("kode punya entropi cukup (>=32 char base64url)", code.length >= 32, code.length);

const crossDivision = await createHandoff("tok-b-admin", extA.id);
eq("user divisi lain minta workspace divisi A → 403", crossDivision.status, 403);

const hubKind = await createHandoff("tok-a-admin", hubA.id);
eq("workspace cms_hub → 422 (bukan dashboard eksternal)", hubKind.status, 422);

const ghost = await createHandoff("tok-a-admin", "workspace-tidak-ada");
eq("workspace tidak ada → 404", ghost.status, 404);

// ── Penukaran kode (endpoint internal) ───────────────────────────────────────
section("Penukaran kode");

const noSecret = await exchange(code);
eq("exchange tanpa shared secret → 401", noSecret.status, 401);

const wrongSecret = await exchange(code, "secret-salah");
eq("exchange dengan secret salah → 401", wrongSecret.status, 401);

const good = await exchange(code, SECRET);
eq("exchange dengan secret benar → 200", good.status, 200);
eq("exchange mengembalikan user_id peminta", good.body?.data?.user_id, "u-a-admin");
eq("exchange mengembalikan email peminta", good.body?.data?.email, "admin.a@example.com");

const second = await exchange(code, SECRET);
eq("penukaran kedua kode yang sama → 409 (sekali pakai)", second.status, 409);

const unknownCode = await exchange("kode-yang-tidak-pernah-ada", SECRET);
eq("kode tidak dikenal → 404", unknownCode.status, 404);

// ── Kode kadaluarsa ──────────────────────────────────────────────────────────
section("Kode kadaluarsa");

const created2 = await createHandoff("tok-a-admin", extA.id);
const code2 = new URL(created2.body.data.redirect_to).searchParams.get("code") ?? "";
await h.sql(`UPDATE workspace_handoffs SET expires_at = '2020-01-01T00:00:00.000Z' WHERE code = ?`, code2);
const expired = await exchange(code2, SECRET);
eq("kode kadaluarsa → 410", expired.status, 410);

// ── Cleanup kode kadaluarsa (T6) ─────────────────────────────────────────────
section("Cleanup");

await createHandoff("tok-a-admin", extA.id); // insert baru memicu purge baris kadaluarsa
const leftover = await h.sql(`SELECT code FROM workspace_handoffs WHERE code = ?`, code2);
eq("kode kadaluarsa dibersihkan saat insert baru", leftover.length, 0);

// ── is_active = 0 tidak muncul di /me ────────────────────────────────────────
section("Filter is_active di /api/v1/me");

const meBefore = await h.req("/api/v1/me", { token: "tok-a-admin" });
const beforeIds = (meBefore.body?.data?.workspace_options ?? []).map((w: any) => w.id);
ok("sebelum dinonaktifkan, workspace eksternal muncul di /me", beforeIds.includes(extA.id), beforeIds);
ok("/me mengembalikan id per workspace option", beforeIds.every((id: any) => typeof id === "string"), beforeIds);

await h.sql(`UPDATE workspace_options SET is_active = 0 WHERE id = ?`, extA.id);
const meAfter = await h.req("/api/v1/me", { token: "tok-a-admin" });
const afterIds = (meAfter.body?.data?.workspace_options ?? []).map((w: any) => w.id);
ok("is_active = 0 tidak muncul di /me", !afterIds.includes(extA.id), afterIds);

const inactiveCreate = await createHandoff("tok-a-admin", extA.id);
eq("handoff ke workspace nonaktif → 404", inactiveCreate.status, 404);

await h.sql(`UPDATE workspace_options SET is_active = 1 WHERE id = ?`, extA.id);

await h.dispose();

console.log("");
if (failed > 0) {
	console.error(`${failed} check GAGAL, ${passed} lolos`);
	console.error(`\nYang gagal:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
	process.exit(1);
}
console.log(`all ${passed} handoff checks passed`);
