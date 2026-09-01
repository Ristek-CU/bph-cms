import { cloudflareRateLimiter } from "@hono-rate-limiter/cloudflare";
import { ApiError } from "../shared/api-error";
import type { Bindings } from "../types";

// ponytail: Workers Rate Limiting API satu lokasi (per-PoP) — cukup utk trafik baca publik.
export const publicRateLimiter = cloudflareRateLimiter<{ Bindings: Bindings }>({
	rateLimitBinding: (c) => c.env.RATE_LIMITER,
	// Key: IP + path — adil untuk banyak user di satu Wi-Fi (pola gateway-api superapp).
	keyGenerator: (c) => `ip:${c.req.header("cf-connecting-ip") || "anonymous"}:${c.req.path}`,
	handler: () => {
		throw ApiError.tooManyRequests("Terlalu banyak permintaan. Coba beberapa saat lagi.");
	},
});
