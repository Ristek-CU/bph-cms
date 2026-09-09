import { uuidv7 } from "uuidv7";
import { auditLogs } from "../../db/schema";
import type { Db } from "../../db/connection";
import type { Context } from "hono";
import type { AppContext } from "../../types";

export type AuditParams = {
	action: string;
	resourceType: string;
	resourceId?: string | null;
	metadata?: Record<string, unknown> | null;
};

export const recordAuditLog = async (c: Context<AppContext>, params: AuditParams) => {
	try {
		const db = c.get("db");
		await db.insert(auditLogs).values({
			id: uuidv7(),
			actorUserId: c.get("userId") ?? null,
			actorEmail: c.get("userEmail") ?? null,
			actorDivisionId: c.get("activeDivisionId") ?? null,
			action: params.action,
			resourceType: params.resourceType,
			resourceId: params.resourceId ?? null,
			metadata: params.metadata ? JSON.stringify(params.metadata) : null,
			ipAddress: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || null,
			userAgent: c.req.header("user-agent") || null,
			createdAt: new Date().toISOString(),
		});
	} catch (err) {
		// Jangan blokir request utama bila audit log gagal disimpan — tetapi jangan
		// diam juga: jejak audit yang hilang tanpa tanda adalah masalah tersendiri.
		console.error(
			JSON.stringify({
				timestamp: new Date().toISOString(),
				level: "WARN",
				message: "audit log gagal disimpan",
				action: params.action,
				resourceType: params.resourceType,
				resourceId: params.resourceId ?? null,
				reason: err instanceof Error ? err.message : String(err),
			}),
		);
	}
};
