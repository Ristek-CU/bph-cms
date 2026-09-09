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
	ALLOW_DEV_AUTH?: string;
};

export type Variables = {
	db: Db;
	userId?: string;
	userRole?: string;
	userEmail?: string;
	memberships?: UserMembership[];
	activeDivisionId?: string;
	permissions?: string[];
};

export type AppContext = { Bindings: Bindings; Variables: Variables };
