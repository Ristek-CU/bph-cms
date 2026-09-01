import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { MiddlewareHandler } from "hono";
import * as schema from "./schema";

export type Db = DrizzleD1Database<typeof schema>;

let cachedDb: Db | undefined;

export const getDb = (database: D1Database): Db => {
	if (!cachedDb) {
		cachedDb = drizzle(database, { schema });
	}
	return cachedDb;
};

export const dbMiddleware: MiddlewareHandler<{
	Bindings: { DB: D1Database };
	Variables: { db: Db };
}> = async (c, next) => {
	c.set("db", getDb(c.env.DB));
	await next();
};
