// Route Roro — semua di belakang adminAuth + permission assistant.use.
// Permission "assistant.use" didefinisikan untuk semua role di shared/permissions.
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
const actorFrom = (c: AppContext["Bindings"] extends never ? never : any): ChatActor =>
	({
		userId: c.get("userId"),
		userName: c.get("userName"),
		role: c.get("userRole"),
		divisionId: c.get("activeDivisionId"),
		divisionName: undefined,
		permissions: c.get("permissions") ?? [],
		recordAudit: (action, resourceType, resourceId, metadata) =>
			recordAuditLog(c, { action, resourceType, resourceId, metadata }),
	}) as ChatActor;

const envLlm = (c: any) => c.env;

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
	const actor = actorFrom(c);
	return c.json(
		ApiResponse.ok(
			c,
			"Balasan Roro",
			await assistantService.chat(c.get("db"), actor, envLlm(c), parsed.data),
		),
	);
});

adminAssistantRouter.post("/confirm", async (c) => {
	const parsed = confirmSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		throw ApiError.validation("Body tidak valid", {
			message: ["Body JSON wajib: { conversation_id, message_id }"],
		});
	}
	const actor = actorFrom(c);
	return c.json(
		ApiResponse.ok(c, "Draft dibuat", await assistantService.confirm(c.get("db"), actor, envLlm(c), parsed.data)),
	);
});

adminAssistantRouter.get("/conversations", async (c) => {
	const actor = actorFrom(c);
	return c.json(ApiResponse.ok(c, "Daftar percakapan", await assistantService.listConversations(c.get("db"), actor.userId)));
});

adminAssistantRouter.get("/conversations/:id", async (c) => {
	const actor = actorFrom(c);
	return c.json(
		ApiResponse.ok(
			c,
			"Isi percakapan",
			await assistantService.getConversation(c.get("db"), actor.userId, c.req.param("id")),
		),
	);
});

adminAssistantRouter.delete("/conversations/:id", async (c) => {
	const actor = actorFrom(c);
	await assistantService.deleteConversation(c.get("db"), actor.userId, c.req.param("id"));
	return c.json(ApiResponse.ok(c, "Percakapan dihapus", null));
});

adminAssistantRouter.get("/memory", async (c) => {
	const actor = actorFrom(c);
	return c.json(ApiResponse.ok(c, "Memori Roro tentang kamu", await assistantService.getMemory(c.get("db"), actor.userId)));
});

adminAssistantRouter.get("/usage", async (c) => {
	const actor = actorFrom(c);
	return c.json(ApiResponse.ok(c, "Kuota Roro", await quotaSummary(c.get("db"), actor.userId, envLlm(c))));
});
