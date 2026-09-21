// Route Roro — semua di belakang adminAuth. Permission ditoleransi per-tool:
// chat untuk semua pengurus, eksekusi create_* dicek RBAC saat confirm.
import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../../types";
import { adminAuth } from "../../middlewares/admin-auth";
import { requireOversightAccess } from "../../middlewares/oversight-access";
import { ApiResponse } from "../../shared/api-response";
import { ApiError } from "../../shared/api-error";
import { recordAuditLog } from "../audit/audit.service";
import { d1RateLimiter } from "../../middlewares/rate-limiter";
import { assistantService, quotaSummary, type ChatActor } from "./service";
import { logAiEvent, oversightService } from "./oversight.service";

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
		userEmail: c.get("userEmail"),
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

	let connected = true;
	const sse = new ReadableStream({
		cancel() { connected = false; },
		async start(controller) {
			const enc = new TextEncoder();
			const emit = (event: Record<string, unknown>) => {
				if (connected) {
					try { controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { connected = false; }
				}
			};
			try {
				await assistantService.chatStream(db, actor, env, parsed.data!, emit);
			} catch (e) {
				// Error di tengah stream: kirim sebagai event (client sudah menerima 200).
				await logAiEvent({ db, userId: actor.userId, userEmail: actor.userEmail, divisionId: actor.divisionId,
					eventType: "error", level: "error", message: e instanceof ApiError ? e.message : "Kesalahan internal saat streaming",
					metadata: { request_id: c.get("requestId"), status: e instanceof ApiError ? e.statusCode : 500 } });
				emit({ type: "error", message: e instanceof ApiError ? e.message : "Roro mengalami kendala. Coba lagi sebentar.", request_id: c.get("requestId") });
			} finally {
				if (connected) controller.close();
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

// ---- Oversight (khusus akun Ristek) ----------------------------------------
// Baca percakapan + jejak error/aktivitas Roro lintas divisi. Di-gate
// requireOversightAccess (allowlist email RORO_OVERSIGHT_EMAILS), terpisah
// dari RBAC biasa — role divisi lain tidak boleh bisa baca percakapan user lain.

adminAssistantRouter.get("/oversight/stats", requireOversightAccess, async (c) =>
	ApiResponse.ok(c, "Statistik oversight Roro", await oversightService.stats(c.get("db"))),
);

adminAssistantRouter.get("/oversight/conversations", requireOversightAccess, async (c) => {
	const page = Number(c.req.query("page"));
	const perPage = Number(c.req.query("per_page"));
	const divisionId = c.req.query("division_id") || undefined;
	const search = c.req.query("q") || undefined;
	return ApiResponse.ok(
		c,
		"Daftar percakapan lintas divisi",
		await oversightService.listConversations(c.get("db"), { divisionId, search, page, perPage }),
	);
});

adminAssistantRouter.get("/oversight/conversations/:id", requireOversightAccess, async (c) => {
	const data = await oversightService.getConversation(c.get("db"), c.req.param("id"), Number(c.req.query("page")) || 1);
	if (!data) throw ApiError.notFound("Percakapan tidak ditemukan");
	return ApiResponse.ok(c, "Isi percakapan + event", data);
});

adminAssistantRouter.get("/oversight/events", requireOversightAccess, async (c) => {
	const type = c.req.query("type") || undefined;
	const level = c.req.query("level") || undefined;
	const since = c.req.query("since") || undefined;
	const limit = Number(c.req.query("limit"));
	const page = Number(c.req.query("page"));
	return ApiResponse.ok(
		c,
		"Jejak aktivitas & error Roro",
		await oversightService.listEvents(c.get("db"), { type, level, since, limit, page }),
	);
});

adminAssistantRouter.get("/oversight/usage", requireOversightAccess, async (c) => {
	const month = c.req.query("month") || undefined;
	if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw ApiError.validation("Bulan tidak valid", { month: ["Gunakan YYYY-MM"] });
	return ApiResponse.ok(c, "Penggunaan Roro per user", await oversightService.usageBreakdown(c.get("db"), { month }));
});

const flagSchema = z.object({ note: z.string().trim().min(1).max(500) });

adminAssistantRouter.post("/oversight/conversations/:id/flag", requireOversightAccess, async (c) => {
	const parsed = flagSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		throw ApiError.validation("Body tidak valid", { note: ["Wajib: { note (1–500 karakter) }"] });
	}
	const db = c.get("db");
	// Pastikan percakapan ada sebelum menandai — flag tanpa target tidak berguna.
	const exists = await oversightService.getConversation(db, c.req.param("id"));
	if (!exists) throw ApiError.notFound("Percakapan tidak ditemukan");
	await oversightService.flagConversation(db, {
		conversationId: c.req.param("id"),
		userId: c.get("userId"),
		userEmail: c.get("userEmail"),
		divisionId: c.get("activeDivisionId"),
		note: parsed.data.note,
	});
	await recordAuditLog(c, {
		action: "roro.oversight_flag",
		resourceType: "ai_conversation",
		resourceId: c.req.param("id"),
		metadata: { note: parsed.data.note.slice(0, 200) },
	});
	return ApiResponse.ok(c, "Percakapan ditandai", null);
});
