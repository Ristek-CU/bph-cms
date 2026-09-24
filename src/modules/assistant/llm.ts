// Wrapper LLM Anthropic-compatible (RORO-PLAN.md §2). Base URL + key dari env —
// production: https://api.surplusintelligence.ai/anthropic + wrangler secret
// RORO_API_KEY. Tanpa key → fail-closed (ApiError 503 dari service, bukan di sini).
//
// RORO_MOCK (dev/test): JSON array respons yang dikembalikan berurutan, satu per
// panggilan. Dipakai harness test supaya suite tidak menyentuh network.

export type LlmContent = {
	type: "text";
	text: string;
};

// GLM (dan model thinking lain) menyisipkan blok "thinking" di antara text dan
// tool_use — diterima dari API, tapi DISTRIP saat dikirim balik ke messages.
export type LlmThinking = {
	type: "thinking";
	thinking: string;
};

export type LlmToolUse = {
	type: "tool_use";
	id: string;
	name: string;
	input: unknown;
};

export type LlmToolResult = {
	type: "tool_result";
	tool_use_id: string;
	content: string;
	is_error?: boolean;
};

export type LlmMessage = {
	role: "user" | "assistant";
	content: string | Array<LlmToolUse | LlmToolResult | LlmContent | LlmThinking>;
};

export type LlmToolDef = {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
};

export type LlmUsage = { input_tokens: number; output_tokens: number; reported?: boolean };

// Provider usage is cumulative per request; cache tokens are also consumed input.
export const normalizeUsage = (raw: Record<string, unknown> = {}): LlmUsage => {
	const n = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
	return {
		input_tokens: n(raw.input_tokens) + n(raw.cache_creation_input_tokens) + n(raw.cache_read_input_tokens),
		output_tokens: n(raw.output_tokens),
		reported: typeof raw.input_tokens === "number" && typeof raw.output_tokens === "number",
	};
};

export type LlmResponse = {
	content: Array<LlmToolUse | LlmContent | LlmThinking>;
	stop_reason: "end_turn" | "tool_use" | null;
	usage: LlmUsage;
};

// Blok thinking dibuang sebelum dipush balik ke riwayat messages — proxy Anthropic
// menolak assistant message berisi thinking yang bukan hasil signature aslinya.
export const stripThinking = (content: LlmResponse["content"]): Array<LlmToolUse | LlmContent> =>
	content.filter((b): b is LlmToolUse | LlmContent => b.type !== "thinking");

export const llmChat = async (
	env: {
		RORO_API_KEY?: string;
		RORO_BASE_URL?: string;
		RORO_MODEL?: string;
		RORO_MOCK?: string;
	},
	body: {
		system: string;
		messages: LlmMessage[];
		tools: LlmToolDef[];
		max_tokens?: number;
	},
): Promise<LlmResponse> => {
	if (env.RORO_MOCK) {
		// Cache hasil parse di module scope — shift() harus memutasi SATU array yang
		// sama antar panggilan, bukan parse ulang tiap call (selalu fixture pertama).
		const key = "__roroMockQueue";
		const q = ((globalThis as any)[key] ??= JSON.parse(env.RORO_MOCK) as LlmResponse[]);
		const next = q.shift();
		if (!next) throw new Error("RORO_MOCK habis — tambah fixture respons LLM");
		return next;
	}

	if (!env.RORO_API_KEY) throw new LlmUnavailableError("RORO_API_KEY belum di-set");

	const base = (env.RORO_BASE_URL || "https://api.surplusintelligence.ai/anthropic").replace(/\/$/, "");
	const res = await fetchProvider(`${base}/v1/messages`, {
		method: "POST",
		signal: AbortSignal.timeout(120_000),
		headers: {
			"Content-Type": "application/json",
			"x-api-key": env.RORO_API_KEY,
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify({
			model: env.RORO_MODEL || "glm-5.2",
			max_tokens: body.max_tokens ?? 2000,
			system: body.system,
			messages: body.messages,
			tools: body.tools.length ? body.tools : undefined,
		}),
	});

	if (res.status === 401 || res.status === 403) {
		throw new LlmUnavailableError("LLM menolak key (401/403)");
	}
	if (!res.ok) {
		throw new LlmUnavailableError(`LLM error HTTP ${res.status}`);
	}
	const data = (await res.json()) as LlmResponse;
	if (!Array.isArray(data.content)) {
		throw new LlmUnavailableError("LLM membalas bentuk tak dikenal");
	}
	data.usage = normalizeUsage(data.usage);
	return data;
};

const fetchProvider = async (url: string, init: RequestInit): Promise<Response> => {
	try { return await fetch(url, init); }
	catch { throw new LlmUnavailableError("Layanan AI tidak merespons atau koneksi terputus"); }
};

// Beda dari ApiError supaya service bisa menerjemahkan ke pesan chat yang ramah,
// bukan 500 yang jelek. Endpoint tetap 200 — kegagalan LLM bukan error client.
export class LlmUnavailableError extends Error {}

// ---- Streaming (SSE Anthropic) ----------------------------------------------
// GLM 5.2 selalu berpikir (blok thinking, 4–60 detik, tidak bisa dimatikan di
// key ini). Streaming diperlukan supaya user melihat progres sejak detik pertama:
// thinking ditampilkan sebagai status "lagi mikir", teks final menyusul.

export type StreamEvent =
	| { type: "thinking"; text: string } // delta pikiran
	| { type: "text"; text: string } // delta jawaban final
	| { type: "tool_use_start"; name: string } // model mulai memanggil tool
	| { type: "tool_use"; id: string; name: string; input: unknown; stop_reason: string | null } // utuh, setelah stream selesai
	| { type: "usage"; usage: LlmUsage }
	| { type: "done" };

export const llmChatStream = async function* (
	env: {
		RORO_API_KEY?: string;
		RORO_BASE_URL?: string;
		RORO_MODEL?: string;
		RORO_MOCK?: string;
		RORO_MOCK_STREAM?: string;
	},
	body: {
		system: string;
		messages: LlmMessage[];
		tools: LlmToolDef[];
		max_tokens?: number;
		timeout_ms?: number;
	},
): AsyncGenerator<StreamEvent> {
	// Mock streaming: RORO_MOCK_STREAM berisi array respons; tiap respons = array
	// StreamEvent yang di-yield berurutan (tool_use harus sudah utuh di dalamnya).
	// Urutan antar-antrian sama dengan RORO_MOCK (satu respons per panggilan).
	// Mock sebelum key-check — pola sama dengan llmChat.
	if (env.RORO_MOCK_STREAM) {
		const key = "__roroMockStreamQueue";
		const q = ((globalThis as any)[key] ??= JSON.parse(env.RORO_MOCK_STREAM) as StreamEvent[][]);
		const next = q.shift();
		if (!next) throw new Error("RORO_MOCK_STREAM habis — tambah fixture respons LLM");
		for (const ev of next) yield ev;
		yield { type: "done" };
		return;
	}

	if (!env.RORO_API_KEY) throw new LlmUnavailableError("RORO_API_KEY belum di-set");

	const base = (env.RORO_BASE_URL || "https://api.surplusintelligence.ai/anthropic").replace(/\/$/, "");
	const res = await fetchProvider(`${base}/v1/messages`, {
		method: "POST",
		signal: AbortSignal.timeout(body.timeout_ms ?? 120_000),
		headers: {
			"Content-Type": "application/json",
			"x-api-key": env.RORO_API_KEY,
			"anthropic-version": "2023-06-01",
			// Surplus memilih seller dengan latensi terendah dalam price band.
			"X-SI-Route-Objective": "latency",
		},
		body: JSON.stringify({
			model: env.RORO_MODEL || "glm-5.2",
			max_tokens: body.max_tokens ?? 2000,
			stream: true,
			system: body.system,
			messages: body.messages,
			tools: body.tools.length ? body.tools : undefined,
		}),
	});

	if (!res.ok || !res.body) {
		if (res.status === 401 || res.status === 403) throw new LlmUnavailableError("LLM menolak key (401/403)");
		throw new LlmUnavailableError(`LLM error HTTP ${res.status}`);
	}

	// Parse SSE: baris "data: {json}" dipisah baris kosong. Yang dipakai:
	// thinking_delta, text_delta, tool_use (content_block_start + input_json_delta),
	// message_stop. GLM sering mengirim text + tool_use dalam SATU respons.
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = "";
	let done = false;
	let stopReason: string | null = null;
	let usage: Record<string, unknown> = {};
	// Akumulasi tool_use: content_block_start memberi id+name, input_json_delta
	// mengalirkan JSON-nya, content_block_stop menandai selesai.
	const tools: Array<{ index: number; id: string; name: string; json: string }> = [];

	try {
	while (!done) {
		const { value, done: eof } = await reader.read();
		if (eof) break;
		buf += decoder.decode(value, { stream: true });
		buf = buf.replace(/\r\n/g, "\n");

		let idx: number;
		while ((idx = buf.indexOf("\n\n")) !== -1) {
			const chunk = buf.slice(0, idx);
			buf = buf.slice(idx + 2);
			const dataLine = chunk.split("\n").find((l) => l.startsWith("data:"));
			if (!dataLine) continue;
			let evt: any;
			try {
				evt = JSON.parse(dataLine.slice(5).trim());
			} catch {
				continue;
			}

			switch (evt.type) {
				case "message_start":
					usage = { ...usage, ...evt.message?.usage };
					break;
				case "error":
					throw new LlmUnavailableError("LLM stream error");
				case "content_block_start":
					if (evt.content_block?.type === "tool_use") {
						tools.push({
							index: evt.index,
							id: evt.content_block.id,
							name: evt.content_block.name,
							json: "",
						});
						yield { type: "tool_use_start", name: evt.content_block.name };
					}
					break;
				case "content_block_delta":
					if (evt.delta?.type === "thinking_delta" && evt.delta.thinking) {
						yield { type: "thinking", text: evt.delta.thinking };
					} else if (evt.delta?.type === "text_delta" && evt.delta.text) {
						yield { type: "text", text: evt.delta.text };
					} else if (evt.delta?.type === "input_json_delta" && evt.delta.partial_json) {
						const t = tools.find((x) => x.index === evt.index);
						if (t) t.json += evt.delta.partial_json;
					}
					break;
				case "message_delta":
					usage = { ...usage, ...evt.usage };
					if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
					break;
				case "message_stop":
					done = true;
					break;
			}
		}
	}

	if (!done) throw new LlmUnavailableError("LLM stream terputus sebelum selesai");
	} catch (error) {
		throw error instanceof LlmUnavailableError ? error : new LlmUnavailableError("LLM stream terputus");
	} finally {
		yield { type: "usage", usage: normalizeUsage(usage) };
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}

	// Tool_use di-yield SETELAH stream selesai — urutan aman untuk loop service
	// (teks & thinking sudah mengalir, payload JSON sudah utuh).
	for (const t of tools) {
		let input: unknown = null;
		try {
			input = JSON.parse(t.json || "{}");
		} catch {
			input = null;
		}
		yield { type: "tool_use", id: t.id, name: t.name, input, stop_reason: stopReason };
	}
	yield { type: "done" };
};
