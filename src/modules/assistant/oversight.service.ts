// Oversight Roro — service untuk akun Ristek: baca percakapan + event/error
// lintas divisi, statistik penggunaan, dan jejak upaya injeksi prompt.
// Tabel ai_events ditulis dari service.ts (logAiEvent) dan dibaca di sini.
// Akses di-gate middleware requireOversightAccess (allowlist email Ristek).
import { and, asc, count, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { Db } from "../../db/connection";
import {
	aiConversations,
	aiEvents,
	aiMessages,
	aiUsage,
	cmsMemberships,
	divisions,
} from "../../db/schema";
import { todayWib } from "./prompt";

// Bentuk pesan konsisten snake_case dengan service.ts — didefinisikan lokal di
// sini supaya oversight.service tidak mengimpor dari service.ts (menghindari
// impor melingkar: service.ts mengimpor logAiEvent dari sini).
const messageShape = (m: typeof aiMessages.$inferSelect) => ({
	id: m.id,
	conversation_id: m.conversationId,
	role: m.role,
	content: m.content,
	proposal_json: m.proposalJson ? safeJson(m.proposalJson) : null,
	proposal_status: m.proposalStatus,
	tool_name: m.toolName,
	result_resource_id: m.resultResourceId,
	input_tokens: m.inputTokens,
	output_tokens: m.outputTokens,
	created_at: m.createdAt,
});

export type AiEventLevel = "info" | "warn" | "error";
export type AiEventType =
	| "chat_request"
	| "tool_result"
	| "model_usage"
	| "conversation_deleted"
	| "chat_turn"
	| "tool_use"
	| "proposal"
	| "confirm"
	| "error"
	| "llm_unavailable"
	| "injection_blocked"
	| "code_blocked"
	| "quota_exceeded"
	| "rescue"
	| "fake_call"
	| "promise_without_tool"
	| "flag";

export type LogAiEventParams = {
	db: Db;
	conversationId?: string | null;
	userId?: string | null;
	userEmail?: string | null;
	divisionId?: string | null;
	eventType: AiEventType;
	level: AiEventLevel;
	message: string;
	metadata?: Record<string, unknown> | null;
};

// Pencatatan event TIDAK boleh memblokir percakapan utama — gagal diam-diam
// (cuma console.warn), sama seperti recordAuditLog. Dipanggil dari service.ts.
export const logAiEvent = async (p: LogAiEventParams) => {
	try {
		await p.db.insert(aiEvents).values({
			id: uuidv7(),
			conversationId: p.conversationId ?? null,
			userId: p.userId ?? null,
			userEmail: p.userEmail ?? null,
			divisionId: p.divisionId ?? null,
			eventType: p.eventType,
			level: p.level,
			message: p.message.slice(0, 1000),
			metadata: p.metadata ? JSON.stringify(p.metadata) : null,
			createdAt: new Date().toISOString(),
		});
	} catch (err) {
		console.error(
			JSON.stringify({
				timestamp: new Date().toISOString(),
				level: "WARN",
				message: "ai_event gagal disimpan",
				eventType: p.eventType,
				reason: err instanceof Error ? err.message : String(err),
			}),
		);
	}
};

const eventShape = (e: typeof aiEvents.$inferSelect, ctx: { email?: string | null; divisionName?: string | null }) => ({
	id: e.id,
	conversation_id: e.conversationId,
	user_id: e.userId,
	user_email: e.userEmail ?? ctx.email ?? null,
	division_id: e.divisionId,
	division_name: ctx.divisionName ?? null,
	event_type: e.eventType,
	level: e.level,
	message: e.message,
	metadata: e.metadata ? safeJson(e.metadata) : null,
	created_at: e.createdAt,
});

const safeJson = (s: string) => {
	try {
		return JSON.parse(s);
	} catch {
		return s;
	}
};

// Ambil email+divisi untuk daftar userId. Ambil membership aktif pertama.
const memberContext = async (db: Db, userIds: string[]) => {
	if (userIds.length === 0) return new Map<string, { email: string | null; divisionName: string | null; divisionId: string | null }>();
	const rows = await db
		.select({ m: cmsMemberships, d: divisions })
		.from(cmsMemberships)
		.leftJoin(divisions, eq(divisions.id, cmsMemberships.divisionId))
		.where(and(inArray(cmsMemberships.userId, userIds), eq(cmsMemberships.status, "active")));
	const map = new Map<string, { email: string | null; divisionName: string | null; divisionId: string | null }>();
	for (const r of rows) {
		if (!map.has(r.m.userId)) {
			map.set(r.m.userId, { email: r.m.userEmail, divisionName: r.d?.name ?? null, divisionId: r.m.divisionId });
		}
	}
	return map;
};

const nextMonth = (month: string) => {
	const [year, m] = month.split("-").map(Number);
	return `${m === 12 ? year + 1 : year}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
};

const monthOf = (day: string) => day.slice(0, 7);

export const oversightService = {
	// ---- Statistik agregat (kartu ringkasan) -----------------------------

	async stats(db: Db) {
		const day = todayWib();
		const month = monthOf(day);
		const [cConv, cMsg, cEv, cErr, cInj, cCode] = await Promise.all([
			db.select({ n: count() }).from(aiConversations),
			db.select({ n: count() }).from(aiMessages),
			db.select({ n: count() }).from(aiEvents),
			db.select({ n: count() }).from(aiEvents).where(eq(aiEvents.level, "error")),
			db.select({ n: count() }).from(aiEvents).where(eq(aiEvents.eventType, "injection_blocked")),
			db.select({ n: count() }).from(aiEvents).where(eq(aiEvents.eventType, "code_blocked")),
		]);
		// Hari ini: permintaan + token
		const [todayRow] = await db
			.select({
				req: sql<number>`coalesce(sum(${aiUsage.requests}),0)`,
				in: sql<number>`coalesce(sum(${aiUsage.inputTokens}),0)`,
				out: sql<number>`coalesce(sum(${aiUsage.outputTokens}),0)`,
			})
			.from(aiUsage)
			.where(eq(aiUsage.day, day));
		// Bulan ini: satu nilai terikat (YYYY-MM-01), bukan param+literal —
		// ?-01 di-parse SQLite sebagai pengurangan, bukan perbandingan string.
		const [monthRow] = await db
			.select({
				req: sql<number>`coalesce(sum(${aiUsage.requests}),0)`,
				in: sql<number>`coalesce(sum(${aiUsage.inputTokens}),0)`,
				out: sql<number>`coalesce(sum(${aiUsage.outputTokens}),0)`,
			})
			.from(aiUsage)
			.where(sql`${aiUsage.day} >= ${month + "-01"} AND ${aiUsage.day} < ${nextMonth(month)}`);
		// Event hari ini (untuk "real-time" feed terbaru) — satu nilai terikat
		// ISO penuh, supaya placeholder ? tidak menempel ke literal "T...".
		const [evToday] = await db
			.select({ n: count() })
			.from(aiEvents)
			.where(sql`${aiEvents.createdAt} >= ${new Date(day + "T00:00:00+07:00").toISOString()}`);
		return {
			conversations: Number(cConv[0]?.n ?? 0),
			messages: Number(cMsg[0]?.n ?? 0),
			events: Number(cEv[0]?.n ?? 0),
			events_today: Number(evToday?.n ?? 0),
			errors: Number(cErr[0]?.n ?? 0),
			injections_blocked: Number(cInj[0]?.n ?? 0),
			code_blocked: Number(cCode[0]?.n ?? 0),
			chats_today: Number(todayRow?.req ?? 0),
			chats_month: Number(monthRow?.req ?? 0),
			tokens_today: { input: Number(todayRow?.in ?? 0), output: Number(todayRow?.out ?? 0) },
			tokens_month: { input: Number(monthRow?.in ?? 0), output: Number(monthRow?.out ?? 0) },
		};
	},

	// ---- Daftar percakapan lintas divisi -----------------------------------

	async listConversations(
		db: Db,
		opts: { divisionId?: string; search?: string; page?: number; perPage?: number } = {},
	) {
		const page = Number.isFinite(opts.page) && opts.page! >= 1 ? Math.floor(opts.page!) : 1;
		const perPage = Number.isFinite(opts.perPage) && opts.perPage ? Math.min(100, Math.max(1, Math.floor(opts.perPage))) : 25;
		const offset = (page - 1) * perPage;

		const conds = [];
		if (opts.divisionId) {
			conds.push(
				sql`EXISTS (SELECT 1 FROM cms_memberships m WHERE m.user_id = ${aiConversations.userId} AND m.division_id = ${opts.divisionId})`,
			);
		}
		if (opts.search) {
			const term = `%${opts.search}%`;
			conds.push(
				or(
					like(aiConversations.title, term),
					sql`EXISTS (SELECT 1 FROM cms_memberships m WHERE m.user_id = ${aiConversations.userId} AND lower(m.user_email) LIKE lower(${term}))`,
				),
			);
		}
		const where = conds.length ? and(...conds) : undefined;

		const rows = await db
			.select()
			.from(aiConversations)
			.where(where)
			.orderBy(desc(aiConversations.updatedAt))
			.limit(perPage)
			.offset(offset);
		const [totalRow] = await db.select({ n: count() }).from(aiConversations).where(where);

		const userIds = [...new Set(rows.map((r) => r.userId))];
		const convIds = rows.map((r) => r.id);
		const memberMap = await memberContext(db, userIds);

		// Hitung pesan per percakapan + pesan terakhir — per-conv (kecil, paralel).
		const [countRows, lastRows] = await Promise.all([
			convIds.length
				? db
						.select({ cid: aiMessages.conversationId, n: count() })
						.from(aiMessages)
						.where(inArray(aiMessages.conversationId, convIds))
						.groupBy(aiMessages.conversationId)
				: [],
			Promise.all(
				convIds.map((cid) =>
					db
						.select()
						.from(aiMessages)
						.where(eq(aiMessages.conversationId, cid))
						.orderBy(desc(aiMessages.createdAt))
						.limit(1),
				),
			),
		]);
		const countMap = new Map((countRows as Array<{ cid: string; n: number }>).map((c) => [c.cid, c.n]));
		const lastMap = new Map<string, { role: string; content: string; created_at: string }>();
		for (const arr of lastRows) {
			const m = (arr as Array<typeof aiMessages.$inferSelect>)[0];
			if (m) lastMap.set(m.conversationId, { role: m.role, content: m.content, created_at: m.createdAt });
		}

		return {
			items: rows.map((r) => {
				const ctx = memberMap.get(r.userId);
				const last = lastMap.get(r.id);
				return {
					id: r.id,
					title: r.title,
					deleted_at: r.deletedAt,
					user_id: r.userId,
					user_email: ctx?.email ?? null,
					division_id: ctx?.divisionId ?? null,
					division_name: ctx?.divisionName ?? null,
					message_count: countMap.get(r.id) ?? 0,
					last_message: last?.content ?? null,
					last_role: last?.role ?? null,
					last_at: last?.created_at ?? null,
					created_at: r.createdAt,
					updated_at: r.updatedAt,
				};
			}),
			meta: { page, per_page: perPage, total: Number(totalRow?.n ?? 0) },
		};
	},

	// ---- Isi satu percakapan lintas divisi + event-nya ---------------------

	async getConversation(db: Db, id: string, page = 1) {
		page = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
		const [conv] = await db.select().from(aiConversations).where(eq(aiConversations.id, id));
		if (!conv) return null;
		const messages = await db
			.select()
			.from(aiMessages)
			.where(eq(aiMessages.conversationId, id))
			.orderBy(asc(aiMessages.createdAt), asc(aiMessages.id))
			.limit(101).offset((page - 1) * 100);
		const events = await db
			.select()
			.from(aiEvents)
			.where(eq(aiEvents.conversationId, id))
			.orderBy(desc(aiEvents.createdAt), desc(aiEvents.id))
			.limit(101).offset((page - 1) * 100);
		const ctx = (await memberContext(db, [conv.userId])).get(conv.userId);
		return {
			conversation: {
				id: conv.id,
				title: conv.title,
				deleted_at: conv.deletedAt,
				user_id: conv.userId,
				user_email: ctx?.email ?? null,
				division_id: ctx?.divisionId ?? null,
				division_name: ctx?.divisionName ?? null,
				created_at: conv.createdAt,
				updated_at: conv.updatedAt,
			},
			meta: { page, has_more_messages: messages.length > 100, has_more_events: events.length > 100 },
			messages: messages.slice(0, 100).map(messageShape),
			events: events.slice(0, 100).map((e) => eventShape(e, { email: ctx?.email ?? null, divisionName: ctx?.divisionName ?? null })),
		};
	},

	// ---- Feed event/error (real-time) -------------------------------------

	async listEvents(
		db: Db,
		opts: { type?: string; level?: string; since?: string; limit?: number; page?: number } = {},
	) {
		const limit = Number.isFinite(opts.limit) && opts.limit ? Math.min(200, Math.max(1, Math.floor(opts.limit))) : 50;
		const page = Number.isFinite(opts.page) && opts.page! >= 1 ? Math.floor(opts.page!) : 1;
		const conds = [];
		if (opts.type) conds.push(eq(aiEvents.eventType, opts.type));
		if (opts.level) conds.push(eq(aiEvents.level, opts.level));
		if (opts.since) conds.push(sql`${aiEvents.createdAt} >= ${opts.since}`);
		const where = conds.length ? and(...conds) : undefined;
		const rows = await db
			.select()
			.from(aiEvents)
			.where(where)
			.orderBy(desc(aiEvents.createdAt))
			.limit(limit)
			.offset((page - 1) * limit);
		const userIds = [...new Set(rows.map((r) => r.userId).filter((v): v is string => Boolean(v)))];
		const memberMap = await memberContext(db, userIds);
		return rows.map((e) => {
			const ctx = e.userId ? memberMap.get(e.userId) : undefined;
			return eventShape(e, { email: ctx?.email ?? e.userEmail, divisionName: ctx?.divisionName ?? null });
		});
	},

	// ---- Penggunaan per user/divisi (bulan ini default) ---------------------

	async usageBreakdown(db: Db, opts: { month?: string } = {}) {
		const month = opts.month ?? monthOf(todayWib());
		const rows = (await db
			.select({
				userId: aiUsage.userId,
				requests: sql<number>`coalesce(sum(${aiUsage.requests}),0)`,
				inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}),0)`,
				outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}),0)`,
			})
			.from(aiUsage)
			.where(sql`${aiUsage.day} >= ${month + "-01"} AND ${aiUsage.day} < ${nextMonth(month)}`)
			.groupBy(aiUsage.userId)) as Array<{ userId: string; requests: number; inputTokens: number; outputTokens: number }>;
		const memberMap = await memberContext(db, rows.map((r) => r.userId));
		return rows
			.map((r) => {
				const ctx = memberMap.get(r.userId);
				return {
					user_id: r.userId,
					user_email: ctx?.email ?? null,
					division_id: ctx?.divisionId ?? null,
					division_name: ctx?.divisionName ?? null,
					requests: Number(r.requests),
					input_tokens: Number(r.inputTokens),
					output_tokens: Number(r.outputTokens),
				};
			})
			.sort((a, b) => b.requests - a.requests);
	},

	// ---- Tandai percakapan (Ristek menandai perlu ditindak) -----------------

	async flagConversation(
		db: Db,
		opts: { conversationId: string; userId?: string | null; userEmail?: string | null; divisionId?: string | null; note: string },
	) {
		await logAiEvent({
			db,
			conversationId: opts.conversationId,
			userId: opts.userId ?? null,
			userEmail: opts.userEmail ?? null,
			divisionId: opts.divisionId ?? null,
			eventType: "flag",
			level: "warn",
			message: opts.note.slice(0, 500) || "Ditandai oleh Ristek",
			metadata: { flagged_by: opts.userEmail ?? null },
		});
		return { ok: true as const };
	},
};
