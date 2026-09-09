import type { MiddlewareHandler } from "hono";
import { cloudflareRateLimiter } from "@hono-rate-limiter/cloudflare";
import { ApiError } from "../shared/api-error";
import { consumeRateLimit, purgeExpiredRateLimits } from "../db/rate-limit";
import type { AppContext, Bindings } from "../types";

const clientIp = (c: Parameters<MiddlewareHandler<AppContext>>[0]) =>
	c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "anonymous";

// Lapisan pertama: Workers Rate Limiting API (per-PoP, murah). `skip` wajib —
// tanpa itu library melempar TypeError saat binding tidak ada (mis. di test).
// Catatan: di production binding ini terbukti tidak menegakkan limit, jadi
// jangan andalkan dia sendirian; d1RateLimiter di bawah adalah penegak nyata.
export const publicRateLimiter = cloudflareRateLimiter<{ Bindings: Bindings }>({
	rateLimitBinding: (c) => c.env.RATE_LIMITER,
	skip: (c) => !c.env.RATE_LIMITER,
	// Key: IP + path — adil untuk banyak user di satu Wi-Fi (pola gateway-api superapp).
	keyGenerator: (c) => `ip:${c.req.header("cf-connecting-ip") || "anonymous"}:${c.req.path}`,
	handler: () => {
		throw ApiError.tooManyRequests("Terlalu banyak permintaan. Coba beberapa saat lagi.");
	},
});

export type D1RateLimitOptions = {
	/** Prefix namespace supaya counter antar-endpoint tidak saling menabrak. */
	prefix: string;
	limit: number;
	windowMs: number;
	/** Tambahan identitas key selain IP, mis. email yang dicoba saat login. */
	suffix?: (c: Parameters<MiddlewareHandler<AppContext>>[0]) => string | Promise<string>;
};

/**
 * Lapisan penegak: fixed-window counter di D1.
 * Dipakai untuk endpoint yang tidak boleh tanpa batas — terutama proxy auth,
 * yang sebelumnya terbuka untuk brute-force password.
 */
export const d1RateLimiter =
	(opts: D1RateLimitOptions): MiddlewareHandler<AppContext> =>
	async (c, next) => {
		const db = c.get("db");
		const suffix = opts.suffix ? `:${await opts.suffix(c)}` : "";
		const key = `${opts.prefix}:${clientIp(c)}:${c.req.path}${suffix}`;

		const result = await consumeRateLimit(db, key, opts.limit, opts.windowMs);
		c.header("X-RateLimit-Limit", String(opts.limit));
		c.header("X-RateLimit-Remaining", String(result.remaining));

		if (!result.allowed) {
			throw ApiError.tooManyRequests(
				"Terlalu banyak permintaan. Coba beberapa saat lagi.",
			);
		}

		// Bersih-bersih di luar jalur request; jangan pernah gagalkan request utama.
		try {
			c.executionCtx.waitUntil(purgeExpiredRateLimits(db));
		} catch {
			// Tidak ada execution context (mis. dipanggil di luar worker) — abaikan.
		}

		return next();
	};
