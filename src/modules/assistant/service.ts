// Service Roro (RORO-PLAN.md §3.4–§3.7): loop chat + tool, gerbang konfirmasi,
// memori per akun, kuota harian/bulanan.
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { ApiError } from "../../shared/api-error";
import { ApiResponse } from "../../shared/api-response";
import type { Db } from "../../db/connection";
import {
	aiConversations,
	aiMessages,
	aiMemories,
	aiUsage,
} from "../../db/schema";
import { LlmUnavailableError, llmChat, type LlmMessage, type LlmToolResult } from "./llm";
import { TOOLS, canUseTool, llmToolDefs, toolByName, type ToolContext } from "./tools";
import { buildSystem, nowWib, todayWib } from "./prompt";
import { eventService } from "../events/event.service";
import { formService } from "../forms/form.service";
import { recordAuditLog } from "../audit/audit.service";

const MAX_TOOL_ROUNDS = 3;
const HISTORY_WINDOW = 30; // pesan yang dikirim ke LLM per giliran
const MEMORY_EVERY = 10; // perbarui memori tiap N pesan user

// Proposal yang disimpan di ai_messages.proposal_json.
export type Proposal = {
	tool: string;
	data: unknown; // sudah tervalidasi schema modul
};

// ---- Kuota (§3.6) -----------------------------------------------------------

const num = (v: string | undefined, dflt: number) => {
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n : dflt;
};

export const quotaCheck = async (
	db: Db,
	userId: string,
	env: { RORO_DAILY_LIMIT?: string; RORO_MONTHLY_LIMIT?: string },
) => {
	const daily = num(env.RORO_DAILY_LIMIT, 40);
	const monthly = num(env.RORO_MONTHLY_LIMIT, 400);
	const day = todayWib();
	const month = day.slice(0, 7);

	const rows = await db
		.select({ day: aiUsage.day, requests: aiUsage.requests })
		.from(aiUsage)
		.where(and(eq(aiUsage.userId, userId), sql`${aiUsage.day} >= ${month}-01`));
	const usedToday = rows.find((r) => r.day === day)?.requests ?? 0;
	const usedMonth = rows.reduce((a, r) => a + r.requests, 0);

	if (usedToday >= daily || usedMonth >= monthly) {
		throw ApiError.tooManyRequests(
			usedMonth >= monthly
				? `Kuota Roro bulan ini sudah habis (${monthly} chat/bulan). Hubungi admin kalau butuh penambahan.`
				: `Kuota Roro hari ini sudah habis (${daily} chat/hari). Coba lagi besok.`,
		);
	}
	return { day, usedToday, usedMonth, daily, monthly };
};

export const quotaRecord = async (
	db: Db,
	userId: string,
	day: string,
	usage: { input_tokens: number; output_tokens: number },
) => {
	await db
		.insert(aiUsage)
		.values({
			userId,
			day,
			requests: 1,
			inputTokens: usage.input_tokens,
			outputTokens: usage.output_tokens,
		})
		.onConflictDoUpdate({
			target: [aiUsage.userId, aiUsage.day],
			set: {
				requests: sql`${aiUsage.requests} + 1`,
				inputTokens: sql`${aiUsage.inputTokens} + ${usage.input_tokens}`,
				outputTokens: sql`${aiUsage.outputTokens} + ${usage.output_tokens}`,
			},
		});
};

export const quotaSummary = async (
	db: Db,
	userId: string,
	env: { RORO_DAILY_LIMIT?: string; RORO_MONTHLY_LIMIT?: string },
) => {
	const day = todayWib();
	const month = day.slice(0, 7);
	const rows = await db
		.select()
		.from(aiUsage)
		.where(and(eq(aiUsage.userId, userId), sql`${aiUsage.day} >= ${month}-01`));
	const daily = num(env.RORO_DAILY_LIMIT, 40);
	const monthly = num(env.RORO_MONTHLY_LIMIT, 400);
	const usedToday = rows.find((r) => r.day === day)?.requests ?? 0;
	const usedMonth = rows.reduce((a, r) => a + r.requests, 0);
	return {
		today: { used: usedToday, limit: daily },
		month: { used: usedMonth, limit: monthly },
	};
};

// ---- Percakapan --------------------------------------------------------------

const conversationOr404 = async (db: Db, id: string, userId: string) => {
	const [conv] = await db
		.select()
		.from(aiConversations)
		.where(and(eq(aiConversations.id, id), eq(aiConversations.userId, userId)));
	if (!conv) throw ApiError.notFound("Percakapan tidak ditemukan");
	return conv;
};

export type ChatActor = {
	userId: string;
	userName?: string;
	role?: string;
	divisionId?: string;
	divisionName?: string;
	permissions: string[];
	// Untuk audit log.
	recordAudit: (action: string, resourceType: string, resourceId: string | null, metadata?: Record<string, unknown>) => Promise<void>;
};

// Eksekusi tool read in-loop; write tool DILARANG di sini (digate lewat confirm).
const runReadTool = async (ctx: ChatActor, toolCtx: ToolContext, name: string) => {
	const tool = toolByName(name);
	if (!tool || tool.kind !== "read") return { ok: false as const, error: `Tool "${name}" tidak tersedia untuk eksekusi langsung.` };
	if (!canUseTool(ctx.permissions, tool, { isOwnDivision: true })) {
		return { ok: false as const, error: "User tidak punya izin membaca data itu." };
	}
	return tool.run(toolCtx, {});
};

export const assistantService = {
	// ---- Chat ---------------------------------------------------------------

	async chat(
		db: Db,
		actor: ChatActor,
		env: Parameters<typeof quotaCheck>[2] & {
			RORO_API_KEY?: string;
			RORO_BASE_URL?: string;
			RORO_MODEL?: string;
			RORO_MOCK?: string;
		},
		input: { conversation_id?: string; message: string },
	) {
		await quotaCheck(db, actor.userId, env);

		// 1. Conversation: lanjut atau buat baru.
		let convId = input.conversation_id;
		if (convId) await conversationOr404(db, convId, actor.userId);
		else {
			convId = uuidv7();
			const now = new Date().toISOString();
			await db.insert(aiConversations).values({
				id: convId,
				userId: actor.userId,
				title: input.message.slice(0, 60),
				createdAt: now,
				updatedAt: now,
			});
		}

		// 2. Simpan pesan user.
		const userMsgId = uuidv7();
		await db.insert(aiMessages).values({
			id: userMsgId,
			conversationId: convId,
			role: "user",
			content: input.message.slice(0, 8000),
			createdAt: new Date().toISOString(),
		});

		// 3. Riwayat + memori.
		const history = await db
			.select()
			.from(aiMessages)
			.where(eq(aiMessages.conversationId, convId))
			.orderBy(desc(aiMessages.createdAt))
			.limit(HISTORY_WINDOW);
		const ordered = [...history].reverse();
		const [memory] = await db.select().from(aiMemories).where(eq(aiMemories.userId, actor.userId));

		const llmMessages: LlmMessage[] = ordered.map((m) => ({ role: m.role, content: m.content }));

		// 4. Loop tool — maksimal MAX_TOOL_ROUNDS.
		const toolCtx: ToolContext = {
			db,
			divisionId: actor.divisionId,
			userId: actor.userId,
		};
		let replyText = "";
		let proposal: Proposal | null = null;
		let totalIn = 0;
		let totalOut = 0;

		for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
			let res;
			try {
				res = await llmChat(env, {
					system: buildSystem({
						userName: actor.userName,
						role: actor.role,
						divisionName: actor.divisionName,
						permissions: actor.permissions,
						nowWib: nowWib(),
						memoryMd: memory?.memoryMd,
					}),
					messages: llmMessages,
					tools: llmToolDefs(),
				});
			} catch (e) {
				if (e instanceof LlmUnavailableError) {
					replyText =
						"Roro sedang tidak bisa dihubungi (layanan AI bermasalah). Coba lagi sebentar lagi — pesanmu sudah tersimpan di riwayat.";
					break;
				}
				throw e;
			}
			totalIn += res.usage?.input_tokens ?? 0;
			totalOut += res.usage?.output_tokens ?? 0;

			const toolUses = res.content.filter((b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use");
			const textBlocks = res.content.filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text");
			replyText = textBlocks.map((b) => b.text).join("\n").trim();

			if (res.stop_reason !== "tool_use" || toolUses.length === 0) break;

			// Eksekusi tool yang diminta — read otomatis, write jadi proposal.
			const results: LlmToolResult[] = [];
			for (const tu of toolUses) {
				const tool = toolByName(tu.name);
				if (!tool) {
					results.push({ type: "tool_result", tool_use_id: tu.id, content: "Tool tidak dikenal.", is_error: true });
					continue;
				}
				if (tool.kind === "write") {
					// Validasi keluaran LLM SEBELUM disimpan — keluaran tidak pernah dipercaya.
					const parsed = tool.validate?.safeParse(tu.input);
					if (!parsed?.success) {
						const issues = parsed?.error?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") ?? "payload tidak valid";
						results.push({
							type: "tool_result",
							tool_use_id: tu.id,
							content: `Proposal ditolak validasi: ${issues}. Perbaiki dan usulkan ulang, atau tanyakan detail yang hilang ke user.`,
							is_error: true,
						});
						continue;
					}
					if (!canUseTool(actor.permissions, tool, { isOwnDivision: true })) {
						results.push({
							type: "tool_result",
							tool_use_id: tu.id,
							content: "User tidak punya izin membuat data ini. Jelaskan bahwa aksesnya terbatas.",
							is_error: true,
						});
						continue;
					}
					proposal = { tool: tu.name, data: parsed.data };
					results.push({
						type: "tool_result",
						tool_use_id: tu.id,
						content: "Draf tersimpan dan akan dibuat setelah user mengonfirmasi. Sampaikan ringkasan draf ke user.",
					});
				} else {
					const out = await runReadTool(actor, toolCtx, tu.name);
					results.push({
						type: "tool_result",
						tool_use_id: tu.id,
						content: JSON.stringify(out),
						is_error: !out.ok,
					});
				}
			}
			llmMessages.push({ role: "assistant", content: res.content });
			llmMessages.push({ role: "user", content: results });
		}

		// 5. Simpan balasan + proposal pending (kalau ada).
		const replyId = uuidv7();
		await db.insert(aiMessages).values({
			id: replyId,
			conversationId: convId,
			role: "assistant",
			content: replyText || "(tanpa teks)",
			proposalJson: proposal ? JSON.stringify(proposal) : null,
			proposalStatus: proposal ? "pending" : null,
			toolName: proposal?.tool ?? null,
			inputTokens: totalIn,
			outputTokens: totalOut,
			createdAt: new Date().toISOString(),
		});
		await db
			.update(aiConversations)
			.set({ updatedAt: new Date().toISOString() })
			.where(eq(aiConversations.id, convId));
		await quotaRecord(db, actor.userId, quotaDay(), { input_tokens: totalIn, output_tokens: totalOut });

		// 6. Memori: perbarui tiap MEMORY_EVERY pesan user (panggilan LLM murah).
		const userCount = await db
			.select({ n: sql<number>`count(*)` })
			.from(aiMessages)
			.where(and(eq(aiMessages.conversationId, convId), eq(aiMessages.role, "user")));
		const count = Number(userCount[0]?.n ?? 0);
		if (count > 0 && count % MEMORY_EVERY === 0) {
			await this.updateMemory(db, actor, env, convId).catch(() => {}); // memori gagal ≠ chat gagal
		}

		return {
			conversation_id: convId,
			reply: replyText || "(Roro tidak mengirim teks — coba ulangi)",
			proposal,
			message_id: replyId,
		};
	},

	// ---- Confirm — SATU-SATUNYA jalur eksekusi write ------------------------

	async confirm(db: Db, actor: ChatActor, env: Parameters<typeof quotaCheck>[2], input: { conversation_id: string; message_id: string }) {
		const conv = await conversationOr404(db, input.conversation_id, actor.userId);
		void conv;
		const [msg] = await db
			.select()
			.from(aiMessages)
			.where(and(eq(aiMessages.id, input.message_id), eq(aiMessages.conversationId, input.conversation_id)));
		if (!msg || !msg.proposalJson) throw ApiError.notFound("Proposal tidak ditemukan");
		if (msg.proposalStatus === "executed") throw ApiError.conflict("Proposal ini sudah dieksekusi sebelumnya");
		if (msg.proposalStatus !== "pending") throw ApiError.conflict("Proposal tidak lagi bisa dikonfirmasi");

		const proposal = JSON.parse(msg.proposalJson) as Proposal;
		const tool = toolByName(proposal.tool);
		if (!tool || tool.kind !== "write") throw ApiError.badRequest("Proposal tidak dikenal");

		// RBAC dicek SAAT confirm — permission bisa berubah sejak proposal dibuat.
		if (!canUseTool(actor.permissions, tool, { isOwnDivision: true })) {
			await db
				.update(aiMessages)
				.set({ proposalStatus: "rejected" })
				.where(eq(aiMessages.id, msg.id));
			throw ApiError.forbidden("Akun kamu tidak punya izin membuat data ini");
		}

		// Validasi ulang saat confirm — schema modul bisa berubah sejak dibuat.
		const parsed = tool.validate?.safeParse(proposal.data);
		if (!parsed?.success) {
			throw ApiError.validation("Draf tidak lagi valid — minta Roro menyusun ulang", {
				proposal: parsed?.error?.issues?.map((i) => i.message) ?? ["payload tidak valid"],
			});
		}

		// Guard dobel-eksekusi: update bersyarat — baris kedua gagal (0 row updated).
		const claim = await db
			.update(aiMessages)
			.set({ proposalStatus: "executed" })
			.where(and(eq(aiMessages.id, msg.id), eq(aiMessages.proposalStatus, "pending")))
			.returning({ id: aiMessages.id });
		if (claim.length === 0) throw ApiError.conflict("Proposal sudah dieksekusi");

		let resourceId: string;
		if (proposal.tool === "create_event") {
			const created = await eventService.create(db, parsed.data as never, {
				divisionId: actor.divisionId,
				userId: actor.userId,
			});
			resourceId = created.id;
		} else {
			const created = await formService.create(db, parsed.data as never, {
				divisionId: actor.divisionId,
				userId: actor.userId,
			});
			resourceId = created.id;
		}

		await db
			.update(aiMessages)
			.set({ resultResourceId: resourceId })
			.where(eq(aiMessages.id, msg.id));

		await actor.recordAudit(`assistant.confirm_${proposal.tool}`, proposal.tool === "create_event" ? "event" : "form", resourceId, {
			via: "roro",
			conversation_id: input.conversation_id,
		});

		return {
			tool: proposal.tool,
			resource_id: resourceId,
		};
	},

	// ---- Memori ----------------------------------------------------------------

	async updateMemory(
		db: Db,
		actor: ChatActor,
		env: Parameters<typeof quotaCheck>[2] & { RORO_API_KEY?: string },
		conversationId: string,
	) {
		const history = await db
			.select()
			.from(aiMessages)
			.where(eq(aiMessages.conversationId, conversationId))
			.orderBy(asc(aiMessages.createdAt))
			.limit(60);
		if (history.length === 0) return;

		const [memory] = await db.select().from(aiMemories).where(eq(aiMemories.userId, actor.userId));
		const transcript = history.map((m) => `${m.role}: ${m.content}`).join("\n").slice(-6000);

		const res = await llmChat(env, {
			system:
				"Ringkas preferensi dan fakta penting tentang user dari percakapan berikut menjadi markdown " +
				"(maks 15 baris, bullet). Fokus: divisi/role, jenis event/form yang sering dibuat, gaya kerja, " +
				"preferensi format. Gabungkan dengan memori lama — pertahankan yang masih relevan. " +
				"Balas HANYA isi markdown, tanpa pembuka.",
			messages: [
				{
					role: "user",
					content: `MEMORI LAMA:\n${memory?.memoryMd ?? "(kosong)"}\n\nPERCAKAPAN:\n${transcript}`,
				},
			],
			tools: [],
			max_tokens: 500,
		});
		const text = res.content
			.filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
			.map((b) => b.text)
			.join("\n")
			.slice(0, 4000);

		await db
			.insert(aiMemories)
			.values({ userId: actor.userId, memoryMd: text, updatedAt: new Date().toISOString() })
			.onConflictDoUpdate({ target: aiMemories.userId, set: { memoryMd: text, updatedAt: new Date().toISOString() } });
	},

	async getMemory(db: Db, userId: string) {
		const [memory] = await db.select().from(aiMemories).where(eq(aiMemories.userId, userId));
		return memory?.memoryMd ?? "";
	},

	// ---- Daftar percakapan -------------------------------------------------------

	async listConversations(db: Db, userId: string) {
		const rows = await db
			.select()
			.from(aiConversations)
			.where(eq(aiConversations.userId, userId))
			.orderBy(desc(aiConversations.updatedAt))
			.limit(50);
		return rows;
	},

	async getConversation(db: Db, userId: string, id: string) {
		await conversationOr404(db, id, userId);
		const messages = await db
			.select()
			.from(aiMessages)
			.where(eq(aiMessages.conversationId, id))
			.orderBy(asc(aiMessages.createdAt))
			.limit(200);
		return messages;
	},

	async deleteConversation(db: Db, userId: string, id: string) {
		await conversationOr404(db, id, userId);
		await db.delete(aiConversations).where(eq(aiConversations.id, id));
	},
};

// Hari kuota — terpisah supaya chat() bisa memanggil tanpa menghitung ulang.
const quotaDay = () => todayWib();
