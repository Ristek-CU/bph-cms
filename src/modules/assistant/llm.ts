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
	content: string | Array<LlmToolUse | LlmToolResult | LlmContent>;
};

export type LlmToolDef = {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
};

export type LlmUsage = { input_tokens: number; output_tokens: number };

export type LlmResponse = {
	content: Array<LlmToolUse | LlmContent>;
	stop_reason: "end_turn" | "tool_use" | null;
	usage: LlmUsage;
};

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
		const fixtures = JSON.parse(env.RORO_MOCK) as LlmResponse[];
		const next = fixtures.shift();
		if (!next) throw new Error("RORO_MOCK habis — tambah fixture respons LLM");
		return next;
	}

	if (!env.RORO_API_KEY) throw new LlmUnavailableError("RORO_API_KEY belum di-set");

	const base = (env.RORO_BASE_URL || "https://api.surplusintelligence.ai/anthropic").replace(/\/$/, "");
	const res = await fetch(`${base}/v1/messages`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": env.RORO_API_KEY,
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify({
			model: env.RORO_MODEL || "claude-sonnet-4-5",
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
	return data;
};

// Beda dari ApiError supaya service bisa menerjemahkan ke pesan chat yang ramah,
// bukan 500 yang jelek. Endpoint tetap 200 — kegagalan LLM bukan error client.
export class LlmUnavailableError extends Error {}
