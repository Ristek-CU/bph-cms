import type { Db } from "./db/connection";

export type DivisionSummary = {
	id: string;
	slug: string;
	name: string;
	email?: string | null;
	dashboardUrl?: string | null;
};

export type UserMembership = {
	division: DivisionSummary;
	role: "platform_admin" | "division_admin" | "contributor" | "viewer";
	status: "active" | "suspended";
	permissions: string[];
};

export type WorkspaceOption = {
	label: string;
	kind: "cms_hub" | "external_dashboard";
	url?: string | null;
};

export type Bindings = {
	DB: D1Database;
	BUCKET: R2Bucket;
	AUTH_SERVICE: Fetcher;
	ASSETS: Fetcher;
	RATE_LIMITER: RateLimit;
	API_BASE_URL: string;
	CORS_ORIGIN: string;
	DOCS_ALLOW_EMAILS: string;
	/** Allowlist email akun Ristek untuk oversight Roro (baca percakapan lintas divisi). */
	RORO_OVERSIGHT_EMAILS?: string;
	/** Email yang boleh jadi platform_admin tanpa baris cms_memberships. */
	PLATFORM_BOOTSTRAP_EMAILS?: string;
	/** Shared secret untuk endpoint internal handoff (wrangler secret, jangan di-commit). */
	HANDOFF_SHARED_SECRET?: string;
	ALLOW_DEV_AUTH?: string;
	// ---- Roro AI (RORO-PLAN.md §2) ----
	/** Key surplusintelligence — wrangler secret di production. */
	RORO_API_KEY?: string;
	/** Default: https://api.surplusintelligence.ai/anthropic (Anthropic-compatible). */
	RORO_BASE_URL?: string;
	/** Default: claude-sonnet-4-5. */
	RORO_MODEL?: string;
	/** Kuota chat per user per hari (jumlah request). Default 40. */
	RORO_DAILY_LIMIT?: string;
	/** Kuota chat per user per bulan. Default 400. */
	RORO_MONTHLY_LIMIT?: string;
	/** Hanya dev/test: JSON fixture untuk stub LLM tanpa network. */
	RORO_MOCK?: string;
};

export type Variables = {
	db: Db;
	userId?: string;
	userRole?: string;
	userEmail?: string;
	userName?: string;
	memberships?: UserMembership[];
	activeDivisionId?: string;
	permissions?: string[];
};

export type AppContext = { Bindings: Bindings; Variables: Variables };
