import type { Db } from "./db/connection";

export type Bindings = {
	DB: D1Database;
	BUCKET: R2Bucket;
	AUTH_SERVICE: Fetcher;
	ASSETS: Fetcher;
	RATE_LIMITER: RateLimit;
	API_BASE_URL: string;
	CORS_ORIGIN: string;
};

export type Variables = {
	db: Db;
	userId?: string;
	userRole?: string;
};

export type AppContext = { Bindings: Bindings; Variables: Variables };
