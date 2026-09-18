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
import { LlmUnavailableError, llmChat, llmChatStream, stripThinking, type LlmMessage, type LlmToolResult, type StreamEvent } from "./llm";
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
const runReadTool = async (ctx: ChatActor, toolCtx: ToolContext, name: string, input: unknown) => {
	const tool = toolByName(name);
	if (!tool || tool.kind !== "read") return { ok: false as const, error: `Tool "${name}" tidak tersedia untuk eksekusi langsung.` };
	if (!canUseTool(ctx.permissions, tool, { isOwnDivision: true })) {
		return { ok: false as const, error: "User tidak punya izin membaca data itu." };
	}
	return tool.run(toolCtx, input);
};

// Validasi + gate SATU tool_use dari LLM, push hasilnya ke `results`. Return
// proposal kalau tool write lolos (untuk disimpan di pesan assistant).
// Export untuk test regresi (assistant-stream.test.ts).
export const handleToolUse = async (
	actor: ChatActor,
	toolCtx: ToolContext,
	tu: { id: string; name: string; input: unknown },
	results: LlmToolResult[],
): Promise<Proposal | null> => {
	const tool = toolByName(tu.name);
	if (!tool) {
		results.push({ type: "tool_result", tool_use_id: tu.id, content: "Tool tidak dikenal.", is_error: true });
		return null;
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
			return null;
		}
		if (!canUseTool(actor.permissions, tool, { isOwnDivision: true })) {
			results.push({
				type: "tool_result",
				tool_use_id: tu.id,
				content: "User tidak punya izin membuat data ini. Jelaskan bahwa aksesnya terbatas.",
				is_error: true,
			});
			return null;
		}
		const proposal: Proposal = { tool: tu.name, data: parsed.data };
		results.push({
			type: "tool_result",
			tool_use_id: tu.id,
			content: "Draf tersimpan dan akan dibuat setelah user mengonfirmasi. Sampaikan ringkasan draf ke user.",
		});
		return proposal;
	}
	const out = await runReadTool(actor, toolCtx, tu.name, tu.input);
	results.push({
		type: "tool_result",
		tool_use_id: tu.id,
		content: JSON.stringify(out),
		is_error: !out.ok,
	});
	return null;
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
						/* chat() non-stream tanpa injeksi stats — jalur utama streaming. */
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
			replyText = stripDsml(textBlocks.map((b) => b.text).join("\n").trim());

			if (res.stop_reason !== "tool_use" || toolUses.length === 0) break;

			// Eksekusi tool yang diminta — read otomatis, write jadi proposal.
			const results: LlmToolResult[] = [];
			for (const tu of toolUses) {
				const p = await handleToolUse(actor, toolCtx, tu, results);
				if (p) proposal = p;
			}
			llmMessages.push({ role: "assistant", content: stripThinking(res.content) });
			llmMessages.push({ role: "user", content: results });
		}

		// 5. Simpan balasan + proposal pending (kalau ada).
		replyText = sanitizeReply(replyText, !!proposal);
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

	// ---- Chat streaming (SSE) — jalur utama panel ----------------------------
	//
	// GLM 5.2 berpikir 4–60 detik sebelum menjawab. Versi non-stream bikin user
	// nunggu tanpa umpan balik. Endpoint ini mengalirkan event ke client:
	//   { type: "thinking", text }  — delta pikiran (ditampilkan sebagai status)
	//   { type: "text", text }      — delta jawaban final
	//   { type: "done", ...payload }— bentuk sama dengan chat() + message_id
	// Persist DB + kuota tetap dijalankan di sini SETELAH stream selesai, jadi
	// audit/quota tidak bergantung pada client.

	async chatStream(
		db: Db,
		actor: ChatActor,
		env: Parameters<typeof this.chat>[2],
		input: { conversation_id?: string; message: string },
		emit: (event: Record<string, unknown>) => void,
	) {
		await quotaCheck(db, actor.userId, env);

		// 1. Conversation: lanjut atau buat baru (sama dengan chat()).
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

		const userMsgId = uuidv7();
		await db.insert(aiMessages).values({
			id: userMsgId,
			conversationId: convId,
			role: "user",
			content: input.message.slice(0, 8000),
			createdAt: new Date().toISOString(),
		});

		const history = await db
			.select()
			.from(aiMessages)
			.where(eq(aiMessages.conversationId, convId))
			.orderBy(desc(aiMessages.createdAt))
			.limit(HISTORY_WINDOW);
		const ordered = [...history].reverse();
		const [memory] = await db.select().from(aiMemories).where(eq(aiMemories.userId, actor.userId));

		const llmMessages: LlmMessage[] = ordered.map((m) => ({ role: m.role, content: m.content }));
		const toolCtx: ToolContext = { db, divisionId: actor.divisionId, userId: actor.userId };

		let replyText = "";
		let proposal: Proposal | null = null;
		let totalIn = 0;
		let totalOut = 0;
		let thinkingAll = "";
		let thinkingSent = false;

		// Intent insight → injeksi snapshot statistik asli ke system prompt.
		// ponytail: regex intent + snapshot semua form ber-submissions; kalau
		// divisi punya banyak form, ganti dengan tool yang dipanggil sistem.
		const WANTS_INSIGHT = /insight|statistik|analitik|respon\s?den|responden|jawaban|isi form|rekap/i.test(input.message);
		let formStatsMd: string | undefined;
		if (WANTS_INSIGHT) {
			const { items } = await formService.listAdmin(db, { divisionId: actor.divisionId, perPage: 50 });
			const withSubs = (items as Array<Record<string, unknown>>).filter((f) => Number(f.submission_count ?? 0) > 0).slice(0, 5);
			if (withSubs.length) {
				const chunks: string[] = [];
				for (const f of withSubs) {
					try {
						const st = await formService.analytics(db, String(f.id));
						const lines = [`Form "${st.title}" — total ${st.total_submissions} respons.`];
						for (const fl of st.fields as Array<{ label: string; type: string; distribution?: Record<string, number> | null; average?: number | null; recent?: unknown[] }>) {
							if (fl.distribution && Object.keys(fl.distribution).length) {
								lines.push(`- ${fl.label}: ${Object.entries(fl.distribution).map(([k, v]) => `${k} ${v}`).join(", ")}`);
							} else if (fl.average != null) {
								lines.push(`- ${fl.label}: rata-rata ${fl.average}`);
							}
							// Jawaban teks bebas (paragraph/short_text) — contoh asli untuk insight kualitatif.
							if (fl.recent?.length) {
								const samples = fl.recent.map((r) => JSON.stringify(r)).join(" | ");
								lines.push(`- ${fl.label} (contoh jawaban): ${samples}`);
							}
						}
						chunks.push(lines.join("\n"));
					} catch {
						// satu form gagal ≠ semua gagal
					}
				}
				formStatsMd = chunks.join("\n\n");
			}
		}

		// Satu ronde LLM stream → event ke client. Return true kalau butuh ronde
		// berikutnya (ada tool_use).
		// noTools=true → ronde tanpa tool: model wajib menjawab teks (runde penutup).
		let lastRoundUsedTool = false; // ronde terakhir eksekusi tool → perlu ronde teks penutup
		const streamRound = async (noTools = false): Promise<boolean> => {
			// Akumulasi blok dari delta — dipakai untuk persist + tool loop.
			let textBuf = "";
			const toolUses: Array<{ id: string; name: string; input: unknown }> = [];

			try {
				for await (const ev of llmChatStream(env, {
					system: buildSystem({
						userName: actor.userName,
						role: actor.role,
						divisionName: actor.divisionName,
						permissions: actor.permissions,
						nowWib: nowWib(),
						memoryMd: memory?.memoryMd,
						formStatsMd,
					}),
					messages: llmMessages,
					tools: noTools ? [] : llmToolDefs(),
				})) {
					if (ev.type === "thinking") {
						thinkingAll += ev.text;
						// Emit thinking hanya sampai jawaban final mulai — setelah itu
						// bubble berpindah ke mode jawaban.
						if (!textBuf) emit({ type: "thinking", text: ev.text });
						thinkingSent = true;
						continue;
					}
					if (ev.type === "text") {
						if (!textBuf && thinkingSent) emit({ type: "thinking_done" });
						textBuf += ev.text;
						emit({ type: "text", text: ev.text });
						continue;
					}
					if (ev.type === "tool_use") {
						// Utuh setelah stream selesai (lihat llm.ts) — kumpulkan.
						toolUses.push({ id: ev.id, name: ev.name, input: ev.input });
						continue;
					}
				}
			} catch (e) {
				if (e instanceof LlmUnavailableError) {
					replyText =
						"Roro sedang tidak bisa dihubungi (layanan AI bermasalah). Coba lagi sebentar lagi — pesanmu sudah tersimpan di riwayat.";
					emit({ type: "text", text: replyText });
					return false;
				}
				throw e;
			}

			replyText = stripDsml(replyText + textBuf);
			// ponytail: token stream diabaikan (0), kuota per-request tetap jalan; pasang
			// message_delta usage kalau butuh akurasi token.
			totalIn += 0;
			totalOut += 0;

			if (toolUses.length === 0) {
				lastRoundUsedTool = false;
				return false;
			}
			lastRoundUsedTool = true;

			// Push assistant tool-use + hasil ke riwayat LLM, lalu ronde berikutnya.
			// Assistant message untuk history: teks (kalau ada) + tool_use tanpa thinking.
			llmMessages.push({
				role: "assistant",
				content: [
					...(textBuf ? [{ type: "text" as const, text: textBuf }] : []),
					...toolUses.map((t) => ({ type: "tool_use" as const, id: t.id, name: t.name, input: t.input })),
				],
			});
			const results: LlmToolResult[] = [];
			for (const tu of toolUses) {
				const p = await handleToolUse(actor, toolCtx, tu, results);
				if (p) proposal = p;
			}
			llmMessages.push({ role: "user", content: results });
			return true;
		};

		if (formStatsMd) {
			// Path insight: data asli sudah di system prompt → TANPA tool loop
			// (channel tool GLM tidak stabil + data dari sistem lebih tepercaya).
			// Satu ronde teks murni.
			llmMessages.push({
				role: "user",
				content:
					"(Sistem: ringkas insight HANYA dari data respons form di bagian 'Data respons form TERKINI'. " +
					"Jangan sebut angka di luar data itu. Jawab langsung dalam bahasa Indonesia yang mengalir.)",
			});
			await streamRound(true);
		} else {
			for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
				const needMore = await streamRound();
				if (!needMore) break;
				// Ronde terakhir habis tanpa jawaban teks → paksa ronde penutup TANPA
				// tool, supaya model wajib merangkum hasil tool ke user.
				if (round === MAX_TOOL_ROUNDS - 1 && !replyText.trim()) {
					await streamRound(true);
				}
			}
			// Semua ronde terpakai tool call / teks kosong (mis. DSML dibuang) → satu
			// ronde penutup tanpa tool agar user tetap dapat jawaban. Juga saat ronde
			// terakhir memakai tool: model belum merangkum hasil tool ke user.
			if (!replyText.trim() || lastRoundUsedTool) await streamRound(true);
		}

		// Persist — sama seperti chat(). `as Proposal | null`: TS tidak melihat
		// assignment di dalam closure streamRound, narrowing-nya jadi `null`.
		let saved = proposal as Proposal | null;

		// Anti-halusinasi data: model kadang "memanggil tool" SEBAGAI TEKS
		// ([get_form_stats: ...]) lalu mengarang statistik. Deteksi fake-call →
		// buang teks, paksa ronde nyata dengan tool + reminder tegas.
		// Umum: [Tool: ...], [get_form_stats: ...], [create_event] — gaya bebas.
		const FAKE_CALL = /\[\s*(?:tool\b|get_|create_)/i;
		// Varian 2: JSON mentah bocor ke teks ("create_form {...}") — rescue: kalau
		// payload valid, jadikan proposal sungguhan (model tidak perlu ulang).
		if (!saved && !formStatsMd) {
			const rescued = rescueToolCallText(replyText);
			if (rescued && canUseTool(actor.permissions, toolByName(rescued.tool)!, { isOwnDivision: true })) {
				saved = rescued;
				// Buang blok tool-call dari teks; sisakan sapaan/penjelasan lain.
				replyText = replyText
					.replace(/\bcreate_(?:event|form)\s*\{[\s\S]*?\}[\s\S]*?(?=\n|$)/, "")
					.trim();
			}
		}
		if (FAKE_CALL.test(replyText)) {
			replyText = "";
			llmMessages.push({
				role: "user",
				content:
					"(Sistem: pesanmu memuat panggilan tool sebagai teks — itu tidak berfungsi dan berisiko mengarang data. " +
					"Panggil tool sungguhan lewat channel tool, atau jawab jujur bahwa data belum bisa diambil. JANGAN menyebut angka yang tidak keluar dari tool.)",
			});
			await streamRound(false);
			replyText = stripDsml(replyText);
			// Ronde ulang bisa berakhir tool_use lagi (data terambil) → ronde teks
			// terakhir supaya user tetap dapat ringkasan.
			if (!replyText.trim()) await streamRound(true);
		}

		// Path insight lewat guard klaim-kreate: teksnya ringkasan data, bukan
		// klaim eksekusi — regex klaim sukses sering false-positive di sini.
		if (!formStatsMd) replyText = sanitizeReply(replyText, !!saved);
		const replyId = uuidv7();
		await db.insert(aiMessages).values({
			id: replyId,
			conversationId: convId,
			role: "assistant",
			content: replyText || "(tanpa teks)",
			proposalJson: saved ? JSON.stringify(saved) : null,
			proposalStatus: saved ? "pending" : null,
			toolName: saved?.tool ?? null,
			inputTokens: totalIn,
			outputTokens: totalOut,
			createdAt: new Date().toISOString(),
		});
		await db.update(aiConversations).set({ updatedAt: new Date().toISOString() }).where(eq(aiConversations.id, convId));
		await quotaRecord(db, actor.userId, quotaDay(), { input_tokens: totalIn, output_tokens: totalOut });

		emit({
			type: "done",
			conversation_id: convId,
			reply: replyText || "(Roro tidak mengirim teks — coba ulangi)",
			proposal: saved, // termasuk proposal hasil rescue tool-call-as-text
			message_id: replyId,
		});
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
			resourceId = created!.id;
		} else {
			const created = await formService.create(db, parsed.data as never, {
				divisionId: actor.divisionId,
				userId: actor.userId,
			});
			resourceId = created!.id;
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
		return messages.map(messageShape);
	},

	async deleteConversation(db: Db, userId: string, id: string) {
		await conversationOr404(db, id, userId);
		await db.delete(aiConversations).where(eq(aiConversations.id, id));
	},
};

// Hari kuota — terpisah supaya chat() bisa memanggil tanpa menghitung ulang.
const quotaDay = () => todayWib();

// Guard halusinasi eksekusi: GLM kadang menjawab "event sudah dibuat ✅" TANPA
// memanggil tool (terlihat nyata saat proxy tool-calling-nya flaky). Klaim palsu
// ini bahaya — user pikir data sudah masuk. Deteksi klaim sukses pada teks yang
// tidak menyertai proposal, lalu ganti dengan pesan jujur + minta ulang.
// Klaim spesifik pembuatan event/form — BUKAN "pesanmu tersimpan di riwayat"
// (frasa di pesan fail-closed harus lolos guard).
const CLAIMS_CREATED = /(event|form|draf|draft)[^.]{0,40}(sudah|berhasil|telah)\s+(dibuat|dibuatkan|tercatat|tersimpan|dicatat)|(sudah|berhasil|telah)\s+(dibuat|dibuatkan)\s+(di\s+sistem|di\s+database)/i;

// Markup tool-call internal GLM (<｜DSML｜…>) kadang bocor ke channel teks saat
// proxy tool-calling-nya tidak stabil. Bukan konten untuk user — buang; kalau
// seluruh teks jadi kosong, anggap ronde itu "tanpa teks".
const stripDsml = (text: string) => text.replace(/<｜?DSML｜>[\s\S]*?(?:<\/｜?DSML｜>|$)/g, "").replace(/<｜DSML｜[\s\S]*$/g, "").trim();

// GLM kadang mengirim tool call sebagai TEKS: nama tool + JSON mentah tanpa
// bracket gaya fake-call (FAKE_CALL tidak menangkap). Bocoran ini tampil ke user
// sebagai JSON mentah. Rescue: ekstrak JSON-nya, validasi, jadikan proposal asli.
// Return { tool, data } kalau berhasil — null kalau tidak ada/invalid.
const rescueToolCallText = (text: string): Proposal | null => {
	const m = /\bcreate_(event|form)\s*\{\s*"/.exec(text);
	if (!m) return null;
	// Ambil JSON balanced-brace mulai dari "{" pertama setelah nama tool.
	const start = text.indexOf("{", m.index);
	let depth = 0;
	let end = -1;
	for (let i = start; i < text.length; i++) {
		if (text[i] === "{") depth++;
		else if (text[i] === "}") {
			depth--;
			if (depth === 0) {
				end = i + 1;
				break;
			}
		}
	}
	if (end < 0) return null;
	try {
		const data = JSON.parse(text.slice(start, end));
		const tool = toolByName(`create_${m[1]}`);
		const parsed = tool?.validate?.safeParse(data);
		if (!tool || !parsed?.success) return null;
		return { tool: tool.name, data: parsed.data };
	} catch {
		return null;
	}
};
const sanitizeReply = (text: string, hasProposal: boolean): string => {
	if (hasProposal || !text || !CLAIMS_CREATED.test(text)) return text;
	return "Sepertinya draf belum terbentuk di sistem. Bisa diulang — pastikan detail judul, tanggal & jam, serta lokasinya lengkap, lalu aku susun drafnya lewat form yang benar.";
};

// Shape API konsisten snake_case seperti modul lain (panel konsumsi langsung).
const messageShape = (m: typeof aiMessages.$inferSelect) => ({
	id: m.id,
	conversation_id: m.conversationId,
	role: m.role,
	content: m.content,
	proposal_json: m.proposalJson ? (JSON.parse(m.proposalJson) as Proposal) : null,
	proposal_status: m.proposalStatus,
	tool_name: m.toolName,
	result_resource_id: m.resultResourceId,
	created_at: m.createdAt,
});
