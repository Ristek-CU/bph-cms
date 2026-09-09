import { lt, sql } from "drizzle-orm";
import { rateLimits } from "./schema";
import type { Db } from "./connection";

export type RateLimitResult = {
	allowed: boolean;
	remaining: number;
	resetAtMs: number;
};

/**
 * Fixed-window counter di D1.
 *
 * Binding `RATE_LIMITER` Cloudflare terpasang dan terbaca, tetapi di production
 * selalu mengembalikan `success: true` (tidak pernah menegakkan limit), sementara
 * di `wrangler dev` bekerja normal. Karena itu penegakan limit tidak boleh
 * bergantung pada binding tersebut — counter di D1 yang menentukan.
 */
export const consumeRateLimit = async (
	db: Db,
	key: string,
	limit: number,
	windowMs: number,
): Promise<RateLimitResult> => {
	const now = Date.now();
	const windowStart = Math.floor(now / windowMs) * windowMs;

	const [row] = await db
		.insert(rateLimits)
		.values({ rowKey: `${windowStart}#${key}`, windowStart, count: 1 })
		.onConflictDoUpdate({
			target: rateLimits.rowKey,
			set: { count: sql`${rateLimits.count} + 1` },
		})
		.returning({ count: rateLimits.count });

	const count = row?.count ?? 1;
	return {
		allowed: count <= limit,
		remaining: Math.max(0, limit - count),
		resetAtMs: windowStart + windowMs,
	};
};

/** Buang baris window yang sudah lewat supaya tabel tidak tumbuh tanpa batas. */
export const purgeExpiredRateLimits = async (db: Db): Promise<void> => {
	const cutoff = Date.now() - 3_600_000;
	await db.delete(rateLimits).where(lt(rateLimits.windowStart, cutoff)).run();
};
