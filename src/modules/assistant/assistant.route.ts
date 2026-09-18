// Route Roro — semua di belakang adminAuth. Permission ditoleransi per-tool:
// chat untuk semua pengurus, eksekusi create_* dicek RBAC saat confirm.
import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../../types";
import { adminAuth } from "../../middlewares/admin-auth";
import { ApiResponse } from "../../shared/api-response";
import { ApiError } from "../../shared/api-error";
import { recordAuditLog } from "../audit/audit.service";
import { d1RateLimiter } from "../../middlewares/rate-limiter";
import { assistantService, quotaSummary, type ChatActor } from "./service";

const chatSchema = z.object({
	conversation_id: z.string().min(1).optional(),
	message: z.string().trim().min(1).max(8000),
});

const confirmSchema = z.object({
	conversation_id: z.string().min(1),
	message_id: z.string().min(1),
});

export const adminAssistantRouter = new Hono<AppContext>();

adminAssistantRouter.use("*", adminAuth);

// Actor dari konteks session — tool scope ikut divisi aktif user.
const actorFrom = (c: any): ChatActor =>
	({
		userId: c.get("userId"),
		userName: c.get("userName"),
		role: c.get("userRole"),
		divisionId: c.get("activeDivisionId"),
		divisionName: undefined,
		permissions: c.get("permissions") ?? [],
		recordAudit: (action: string, resourceType: string, resourceId: string | null, metadata?: Record<string, unknown>) =>
			recordAuditLog(c, { action, resourceType, resourceId, metadata }),
	}) as ChatActor;

// Anti spam: 20 pesan / 5 menit per user (di luar kuota harian §3.6).
const chatLimiter = d1RateLimiter({
	prefix: "assistant:chat",
	limit: 20,
	windowMs: 5 * 60_000,
	suffix: (c) => c.get("userId") ?? "",
});

adminAssistantRouter.post("/chat", chatLimiter, async (c) => {
	const parsed = chatSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		throw ApiError.validation("Body tidak valid", { message: ["Body JSON wajib: { conversation_id?, message }"] });
	}
	return ApiResponse.ok(
		c,
		"Balasan Roro",
		await assistantService.chat(c.get("db"), actorFrom(c), c.env, parsed.data),
	);
});

// Chat streaming — jalur utama panel. SSE: event thinking/text/done lihat
// assistantService.chatStream. Streaming dulu status, lalu baru JSON validasi —
// error body/kuota tetap HTTP error biasa (sebelum stream mulai).
adminAssistantRouter.post("/chat/stream", chatLimiter, async (c) => {
	const parsed = chatSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		throw ApiError.validation("Body tidak valid", { message: ["Body JSON wajib: { conversation_id?, message }"] });
	}
	const actor = actorFrom(c);
	const db = c.get("db");
	const env = c.env;

	const sse = new ReadableStream({
		async start(controller) {
			const enc = new TextEncoder();
			const emit = (event: Record<string, unknown>) => {
				controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
			};
			try {
				await assistantService.chatStream(db, actor, env, parsed.data!, emit);
			} catch (e) {
				// Error di tengah stream: kirim sebagai event (client sudah menerima 200).
				emit({ type: "error", message: e instanceof Error ? e.message : "Terjadi kesalahan" });
			} finally {
				controller.close();
			}
		},
	});

	return new Response(sse, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
});

adminAssistantRouter.post("/confirm", async (c) => {
	const parsed = confirmSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		throw ApiError.validation("Body tidak valid", {
			message: ["Body JSON wajib: { conversation_id, message_id }"],
		});
	}
	return ApiResponse.ok(
		c,
		"Draft dibuat",
		await assistantService.confirm(c.get("db"), actorFrom(c), c.env, parsed.data),
	);
});

adminAssistantRouter.get("/conversations", async (c) =>
	ApiResponse.ok(c, "Daftar percakapan", await assistantService.listConversations(c.get("db"), actorFrom(c).userId)),
);

adminAssistantRouter.get("/conversations/:id", async (c) =>
	ApiResponse.ok(c, "Isi percakapan", await assistantService.getConversation(c.get("db"), actorFrom(c).userId, c.req.param("id"))),
);

adminAssistantRouter.delete("/conversations/:id", async (c) => {
	await assistantService.deleteConversation(c.get("db"), actorFrom(c).userId, c.req.param("id"));
	return ApiResponse.ok(c, "Percakapan dihapus", null);
});

adminAssistantRouter.get("/memory", async (c) =>
	ApiResponse.ok(c, "Memori Roro tentang kamu", await assistantService.getMemory(c.get("db"), actorFrom(c).userId)),
);

adminAssistantRouter.get("/usage", async (c) =>
	ApiResponse.ok(c, "Kuota Roro", await quotaSummary(c.get("db"), actorFrom(c).userId, c.env)),
);
