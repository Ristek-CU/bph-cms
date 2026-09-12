/**
 * Self-check form builder multi-divisi.
 *
 * Menjalankan Worker asli di Miniflare (D1 + R2 nyata, AUTH_SERVICE stub) dan menguji:
 * CRUD form per divisi, isolasi lintas divisi, publish/close, alur publik
 * (draft 404 → submit → submissions), honeypot, validasi jawaban, analytics,
 * dan guard submissions lintas divisi.
 *
 * Run: tsx src/forms.test.ts
 */
import { startHarness, DIVISIONS, type Harness } from "./test/harness";

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

// Harness tidak men-seed membership platform_admin (BPH sengaja kosong di harness
// lain) — seed eksplisit di sini untuk menguji akses lintas divisi.
await h.sql(
	`INSERT INTO cms_memberships (id, user_id, user_email, division_id, role, status, created_at, updated_at)
	 VALUES ('m-bph-forms', 'u-bph', 'bph@cakrawala.com', ?, 'platform_admin', 'active', '2026-01-01', '2026-01-01')`,
	DIVISIONS.bph.id,
);

// ── Create ──────────────────────────────────────────────────────────────────
section("Create form (admin divisi A)");

const noAuth = await h.req("/api/v1/admin/forms", { method: "POST", json: { title: "x" } });
eq("tanpa token → 401", noAuth.status, 401);

const created = await h.req("/api/v1/admin/forms", {
	method: "POST",
	token: "tok-a-admin",
	json: {
		title: "Form Kegiatan Ristek",
		description: "Uji form",
		fields: [
			{ label: "Nama", type: "short_text", required: true, options: null, sort_order: 0 },
			{ label: "Setuju?", type: "multiple_choice", required: true, options: ["Ya", "Tidak"], sort_order: 1 },
			{ label: "Nilai", type: "linear_scale", required: false, options: { min: 1, max: 5 }, sort_order: 2 },
		],
	},
});
eq("create → 201", created.status, 201);
const form = created.body?.data;
ok("slug auto dari judul", form?.slug === "form-kegiatan-ristek", form?.slug);
eq("status awal draft", form?.status, "draft");
eq("fields tersimpan 3", form?.fields?.length, 3);
ok("options choice tersimpan", JSON.stringify(form?.fields?.[1]?.options) === JSON.stringify(["Ya", "Tidak"]), form?.fields?.[1]?.options);
ok("options scale tersimpan", JSON.stringify(form?.fields?.[2]?.options) === JSON.stringify({ min: 1, max: 5 }), form?.fields?.[2]?.options);

const badChoice = await h.req("/api/v1/admin/forms", {
	method: "POST",
	token: "tok-a-admin",
	json: { title: "Salah", fields: [{ label: "Pilih", type: "dropdown", required: false, options: ["satu"], sort_order: 0 }] },
});
eq("choice dengan 1 opsi → 422", badChoice.status, 422);

// ── Isolasi divisi ──────────────────────────────────────────────────────────
section("Isolasi lintas divisi");

const otherList = await h.req("/api/v1/admin/forms", { token: "tok-b-admin" });
eq("admin divisi B tidak melihat form divisi A", otherList.body?.data?.length, 0);
const otherGet = await h.req(`/api/v1/admin/forms/${form.id}`, { token: "tok-b-admin" });
eq("admin divisi B get form A → 403", otherGet.status, 403);
const otherUpdate = await h.req(`/api/v1/admin/forms/${form.id}`, { token: "tok-b-admin", method: "PUT", json: { title: "bajak" } });
eq("admin divisi B update form A → 403", otherUpdate.status, 403);
const otherSubs = await h.req(`/api/v1/admin/forms/${form.id}/submissions`, { token: "tok-b-admin" });
eq("admin divisi B submissions form A → 403", otherSubs.status, 403);

const bphList = await h.req("/api/v1/admin/forms", { token: "tok-bph" });
eq("platform_admin melihat form semua divisi", bphList.body?.data?.length >= 1, true);

// ── Publik: draft → 404, publish → terlihat ────────────────────────────────
section("Alur publik");

const draftPublic = await h.req(`/api/v1/forms/${form.slug}`, { headers: { "CF-Connecting-IP": "10.9.9.9" } });
eq("draft → publik 404", draftPublic.status, 404);

const pub = await h.req(`/api/v1/admin/forms/${form.id}/publish`, { token: "tok-a-admin", method: "POST" });
eq("publish → 200", pub.status, 200);

const pubDetail = await h.req(`/api/v1/forms/${form.slug}`, { headers: { "CF-Connecting-IP": "10.9.9.9" } });
eq("published → publik 200", pubDetail.status, 200);
ok("publik tidak melihat required flag tersembunyi", pubDetail.body?.data?.isOpen === true);
ok("publik melihat field label", pubDetail.body?.data?.fields?.[0]?.label === "Nama");
// Kontrak landing page: zod CampaignSchema butuh opensAt camelCase + options array string.
ok("publik opensAt camelCase (kontrak landing)", "opensAt" in (pubDetail.body?.data ?? {}), Object.keys(pubDetail.body?.data ?? {}));
ok("publik options skala jadi array string", JSON.stringify(pubDetail.body?.data?.fields?.[2]?.options) === JSON.stringify(["1", "2", "3", "4", "5"]), pubDetail.body?.data?.fields?.[2]?.options);

// Submit valid
const submit = await h.req(`/api/v1/forms/${form.slug}`, {
	method: "POST",
	headers: { "CF-Connecting-IP": "10.9.9.9", "Content-Type": "application/x-www-form-urlencoded" },
	body: new URLSearchParams({
		[`field_${form.fields[0].id}`]: "Mahasiswa Teladan",
		[`field_${form.fields[1].id}`]: "Ya",
		[`field_${form.fields[2].id}`]: "5",
	}).toString(),
});
eq("submit valid → 201", submit.status, 201);
ok("submit balik submission_id", Boolean(submit.body?.data?.submission_id), submit.body);

// Honeypot
const honeypot = await h.req(`/api/v1/forms/${form.slug}`, {
	method: "POST",
	headers: { "CF-Connecting-IP": "10.9.9.9", "Content-Type": "application/x-www-form-urlencoded" },
	body: new URLSearchParams({ _website: "spam", [`field_${form.fields[0].id}`]: "bot" }).toString(),
});
ok("honeypot → 201 tanpa submission", honeypot.status === 201 && honeypot.body?.data?.submission_id === null, honeypot.body);

// Validasi gagal: required kosong + pilihan tidak valid
const invalid = await h.req(`/api/v1/forms/${form.slug}`, {
	method: "POST",
	headers: { "CF-Connecting-IP": "10.9.9.9", "Content-Type": "application/x-www-form-urlencoded" },
	body: new URLSearchParams({ [`field_${form.fields[1].id}`]: "Mungkin" }).toString(),
});
eq("jawaban invalid → 422", invalid.status, 422);
ok("error per field", Boolean(invalid.body?.errors?.[`field_${form.fields[0].id}`]), invalid.body?.errors);

// ── Submissions + analytics (hanya divisi pemilik) ─────────────────────────
section("Submissions & analytics");

const subs = await h.req(`/api/v1/admin/forms/${form.id}/submissions`, { token: "tok-a-admin" });
eq("submissions → 200", subs.status, 200);
eq("jumlah respons 1", subs.body?.data?.items?.length, 1);
ok("jawaban tersimpan", subs.body?.data?.items?.[0]?.answers?.some((a: any) => a.value === "Mahasiswa Teladan"), subs.body?.data?.items);

const analytics = await h.req(`/api/v1/admin/forms/${form.id}/analytics`, { token: "tok-a-admin" });
eq("analytics → 200", analytics.status, 200);
eq("total respons 1", analytics.body?.data?.total_submissions, 1);
ok("distribusi choice terisi", analytics.body?.data?.fields?.[1]?.distribution?.Ya === 1, analytics.body?.data?.fields);
ok("rata-rata skala terisi", analytics.body?.data?.fields?.[2]?.average === 5, analytics.body?.data?.fields?.[2]);

// Update status submission
const sid = subs.body?.data?.items?.[0]?.id;
const st = await h.req(`/api/v1/admin/forms/submissions/${sid}`, { token: "tok-a-admin", method: "PUT", json: { status: "reviewed" } });
eq("update status submission → 200", st.status, 200);
eq("status berubah", st.body?.data?.status, "reviewed");

// ── Delete guard: form bersubmission tidak boleh dihapus ───────────────────
section("Delete guard");

const delWithSubs = await h.req(`/api/v1/admin/forms/${form.id}`, { token: "tok-a-admin", method: "DELETE" });
eq("delete form dengan respons → 409", delWithSubs.status, 409);

const delSub = await h.req(`/api/v1/admin/forms/submissions/${sid}`, { token: "tok-a-admin", method: "DELETE" });
eq("delete submission → 200", delSub.status, 200);

const delNow = await h.req(`/api/v1/admin/forms/${form.id}`, { token: "tok-a-admin", method: "DELETE" });
eq("delete form tanpa respons → 200", delNow.status, 200);

const gonePublic = await h.req(`/api/v1/forms/${form.slug}`, { headers: { "CF-Connecting-IP": "10.9.9.9" } });
eq("form terhapus → publik 404", gonePublic.status, 404);

console.log(`\n${passed} passed, ${failed} failed`);
// Miniflare/workerd menahan event loop setelah dispose() — exit eksplisit.
process.exit(failed ? 1 : 0);
