// @ts-nocheck
// tsconfig repo ini berisi `types: ["@cloudflare/workers-types"]` tanpa tipe Node,
// sedangkan harness jalan di Node (fs/path, esbuild, miniflare) dan `Headers` versi
// undici bentrok dengan versi workers-types. Harness dijalankan lewat tsx yang
// membuang tipe, jadi file ini dikecualikan dari `npm run typecheck`.
// Assertion di src/security.test.ts tetap ter-typecheck penuh.
/**
 * Harness test integrasi: menjalankan Worker asli (src/index.ts) di dalam
 * Miniflare/workerd dengan D1 + R2 nyata dan AUTH_SERVICE yang di-stub.
 *
 * AUTH_SERVICE di-stub lewat service binding berbentuk fungsi — token Bearer
 * dipetakan ke user, persis seperti service auth superapp membalas
 * GET /v1/access/session.
 */
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// Miniflare menyelesaikan scriptPath relatif terhadap cwd, dan workerd menolak
// modul di luar root project — jadi cwd dikunci ke root repo.
process.chdir(repoRoot);

export type StubUser = { id: string; role: string; email: string };

/** Token → user. Token yang tidak terdaftar dianggap tidak sah (401). */
export const USERS: Record<string, StubUser> = {
	"tok-bph": { id: "u-bph", role: "admin", email: "bph@cakrawala.com" },
	"tok-ristek": { id: "u-ristek", role: "admin", email: "ristek@cakrawala.com" },
	"tok-outsider": { id: "u-outsider", role: "user", email: "orang-luar@example.com" },
	"tok-a-admin": { id: "u-a-admin", role: "user", email: "admin.a@example.com" },
	"tok-a-contrib": { id: "u-a-contrib", role: "user", email: "contrib.a@example.com" },
	"tok-a-viewer": { id: "u-a-viewer", role: "user", email: "viewer.a@example.com" },
	"tok-b-admin": { id: "u-b-admin", role: "user", email: "admin.b@example.com" },
};

/**
 * Id divisi asli dari seed migration `0001_watery_skreet.sql` — test memakai
 * data yang sama dengan production, bukan id bikinan.
 */
export const DIVISIONS = {
	bph: { id: "01990001-0000-7000-8000-000000000001", slug: "bph", name: "BPH" },
	a: { id: "01990001-0000-7000-8000-000000000002", slug: "ristek", name: "Ristek" },
	b: { id: "01990001-0000-7000-8000-000000000003", slug: "ukm", name: "UKM" },
};

export type Harness = {
	/** Kirim request ke worker. `token` jadi Authorization: Bearer. */
	req: (
		path: string,
		init?: {
			method?: string;
			token?: string;
			json?: unknown;
			body?: BodyInit;
			headers?: Record<string, string>;
			/** Hostname request; dipakai menguji guard dev-auth berbasis localhost. */
			host?: string;
		},
	) => Promise<{ status: number; body: any; headers: Headers }>;
	/** Jalankan SQL langsung ke D1 (seed/inspeksi). */
	sql: (statement: string, ...params: unknown[]) => Promise<any[]>;
	dispose: () => Promise<void>;
};

const buildWorker = async () => {
	// workerd menolak scriptPath di luar root project, jadi bundle ditulis ke dalam
	// repo (node_modules sudah di-gitignore) dan dikembalikan sebagai path relatif.
	const relDir = join("node_modules", ".cache", "bph-cms-test");
	const absDir = join(repoRoot, relDir);
	mkdirSync(absDir, { recursive: true });
	const outfile = join(absDir, "worker.mjs");
	await esbuild.build({
		entryPoints: [join(repoRoot, "src/index.ts")],
		bundle: true,
		format: "esm",
		target: "esnext",
		platform: "neutral",
		mainFields: ["module", "main"],
		conditions: ["workerd", "worker", "browser"],
		// Modul builtin workerd disediakan runtime, bukan untuk di-bundle.
		external: ["cloudflare:workers", "node:*", "__STATIC_CONTENT_MANIFEST"],
		outfile,
		logLevel: "silent",
	});
	return join(relDir, "worker.mjs");
};

const migrations = () => {
	const dir = join(repoRoot, "drizzle");
	return readdirSync(dir)
		.filter((f) => f.endsWith(".sql"))
		.sort()
		.flatMap((f) =>
			readFileSync(join(dir, f), "utf8")
				.split("--> statement-breakpoint")
				.map((s) => s.trim())
				.filter(Boolean),
		);
};

export const startHarness = async (
	options: { vars?: Record<string, string> } = {},
): Promise<Harness> => {
	const scriptPath = await buildWorker();

	const mf = new Miniflare(
		convertV4MiniflareOptions({
			modules: true,
			scriptPath,
			compatibilityDate: "2026-08-05",
			compatibilityFlags: ["nodejs_compat"],
			d1Databases: { DB: "test-db" },
			r2Buckets: ["BUCKET"],
			// Binding RATE_LIMITER sengaja tidak ada — Miniflare tidak mendukungnya.
			// Kode harus tahan tanpa binding itu (skip guard), dan d1RateLimiter yang
			// menegakkan limit di test.
			serviceBindings: {
				AUTH_SERVICE: (request: Request) => {
					const token = (request.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
					const user = USERS[token];
					if (!user) {
						return new Response(JSON.stringify({ success: false, statusCode: 401 }), {
							status: 401,
							headers: { "Content-Type": "application/json" },
						});
					}
					return new Response(
						JSON.stringify({ success: true, statusCode: 200, data: { user } }),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				},
			},
			// Miniflare v4 memakai `bindings` untuk plain var (bukan `vars`).
			bindings: {
				API_BASE_URL: "https://bph-cms.test/api/v1",
				// Sama dengan wrangler.jsonc production. localhost:5173 dipakai menguji
				// CORS karena Miniflare menolak Origin ber-hostname non-localhost.
				CORS_ORIGIN:
					"https://sga-cakrawala.org,https://cms.sga-cakrawala.org,http://localhost:5173",
				DOCS_ALLOW_EMAILS: "ristek@cakrawala.com",
				PLATFORM_BOOTSTRAP_EMAILS: "bph@cakrawala.com",
				...options.vars,
			},
		} as any),
	);

	const worker = await mf.getWorker();
	const db = await mf.getD1Database("DB");

	const sql = async (statement: string, ...params: unknown[]) => {
		const res = await db.prepare(statement).bind(...(params as any)).all();
		return res.results as any[];
	};

	// Skema penuh + seed 8 divisi, persis migration yang jalan di production.
	for (const statement of migrations()) {
		await sql(statement);
	}

	const now = new Date().toISOString();

	// Membership eksplisit per role. BPH sengaja TIDAK diberi membership supaya
	// jalur bootstrap tetap teruji seperti kondisi production hari ini
	// (cms_memberships production kosong per 2026-09-10).
	const memberships: Array<[string, string, string, string]> = [
		["m-a-admin", USERS["tok-a-admin"].id, DIVISIONS.a.id, "division_admin"],
		["m-a-contrib", USERS["tok-a-contrib"].id, DIVISIONS.a.id, "contributor"],
		["m-a-viewer", USERS["tok-a-viewer"].id, DIVISIONS.a.id, "viewer"],
		["m-b-admin", USERS["tok-b-admin"].id, DIVISIONS.b.id, "division_admin"],
	];
	for (const [id, userId, divisionId, role] of memberships) {
		await sql(
			`INSERT INTO cms_memberships
			   (id, user_id, user_email, division_id, role, status, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
			id,
			userId,
			Object.values(USERS).find((u) => u.id === userId)!.email,
			divisionId,
			role,
			now,
			now,
		);
	}

	const req: Harness["req"] = async (path, init = {}) => {
		const headers: Record<string, string> = { ...init.headers };
		if (init.token) headers["Authorization"] = `Bearer ${init.token}`;
		let body = init.body;
		if (init.json !== undefined) {
			headers["Content-Type"] = "application/json";
			body = JSON.stringify(init.json);
		}
		const res = await worker.fetch(`http://${init.host ?? "bph-cms.test"}${path}`, {
			method: init.method ?? "GET",
			headers,
			body,
		});
		const text = await res.text();
		let parsed: any;
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = text;
		}
		return { status: res.status, body: parsed, headers: res.headers };
	};

	return { req, sql, dispose: () => mf.dispose() };
};

/** Event helper: ISO WIB + kolom ms, sama seperti yang ditulis service. */
export const seedEvent = async (
	h: Harness,
	opts: {
		id: string;
		slug: string;
		title: string;
		divisionId: string | null;
		status?: "draft" | "published";
		startsAt?: string;
		endsAt?: string;
	},
) => {
	const startsAt = opts.startsAt ?? "2026-09-10T08:00:00+07:00";
	const endsAt = opts.endsAt ?? "2026-09-11T17:00:00+07:00";
	const now = new Date().toISOString();
	await h.sql(
		`INSERT INTO events
		   (id, slug, title, starts_at, ends_at, starts_at_ms, ends_at_ms,
		    location, registration_open, status, division_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 'Aula', 1, ?, ?, ?, ?)`,
		opts.id,
		opts.slug,
		opts.title,
		startsAt,
		endsAt,
		Date.parse(startsAt),
		Date.parse(endsAt),
		opts.status ?? "draft",
		opts.divisionId,
		now,
		now,
	);
};
