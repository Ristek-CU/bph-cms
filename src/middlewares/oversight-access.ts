import type { MiddlewareHandler } from "hono";
import { ApiError } from "../shared/api-error";
import type { AppContext } from "../types";

// Gate khusus fitur oversight Roro: hanya email di allowlist RORO_OVERSIGHT_EMAILS
// (var server, pola sama dengan DOCS_ALLOW_EMAILS). Sengaja TIDAK mengandalkan
// permission RBAC — oversight adalah kemampuan admin Ristek lintas-divisi yang
// tidak boleh dimiliki role divisi lain meski mereka punya audit.read.
// Default kosong = oversight mati total (fail-closed) sampai var di-set.
export const requireOversightAccess: MiddlewareHandler<AppContext> = async (c, next) => {
	const allow = (c.env.RORO_OVERSIGHT_EMAILS ?? "")
		.split(",")
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean);
	const email = (c.get("userEmail") ?? "").toLowerCase();
	if (!allow.includes(email)) {
		throw ApiError.forbidden("Forbidden: akses oversight Roro khusus akun Ristek");
	}
	return next();
};
