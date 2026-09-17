// Tool registry Roro (RORO-PLAN.md §3.3). Dua kelas:
// - "read"    → dieksekusi otomatis in-loop (scope divisi user, persis listAdmin).
// - "write"   → TIDAK dieksekusi di loop. Divalidasi zod, disimpan sebagai proposal
//               pending, menunggu POST /admin/assistant/confirm dari user.
// Menambah kemampuan Roro nanti = tambah satu entri di TOOLS.
import type { z } from "zod";
import type { Db } from "../../db/connection";
import { eventService } from "../events/event.service";
import { formService } from "../forms/form.service";
import { createEventSchema } from "../events/event.schema";
import { createFormSchema } from "../forms/form.schema";

export type ToolContext = {
	db: Db;
	// Scope RBAC: divisi aktif user di session. Undefined = platform_admin lihat semua.
	divisionId?: string;
	userId?: string;
};

export type ToolResult =
	| { ok: true; data: unknown }
	// proposal disimpan service; handler hanya menyediakan data tervalidasi.
	| { ok: false; error: string };

export type ToolEntry = {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
	kind: "read" | "write";
	// Permission persis seperti route manual — dicek saat eksekusi read / saat confirm.
	permission: string;
	run: (ctx: ToolContext, input: unknown) => Promise<ToolResult>;
	// write: schema zod untuk validasi keluaran LLM SEBELUM disimpan sebagai proposal.
	validate?: z.ZodTypeAny;
};

// Ringkas untuk konteks LLM — jangan senutuh dataset penuh (token murah, fokus).
const slimEvent = (e: Record<string, unknown>) => ({
	id: e.id,
	title: e.title,
	starts_at: e.starts_at,
	ends_at: e.ends_at,
	location: e.location,
	status: e.status,
	slug: e.slug,
});
const slimForm = (f: Record<string, unknown>) => ({
	id: f.id,
	title: f.title,
	status: f.status,
	slug: f.slug,
	opens_at: f.opens_at,
	closes_at: f.closes_at,
	submission_count: f.submission_count,
});

export const TOOLS: ToolEntry[] = [
	{
		name: "get_events",
		description:
			"Lihat daftar event milik divisi user (termasuk draft). Dipakai untuk cek jadwal yang sudah ada supaya event baru tidak bentrok.",
		input_schema: { type: "object", properties: {} },
		kind: "read",
		permission: "events.read",
		run: async (ctx) => {
			const { items } = await eventService.listAdmin(ctx.db, {
				divisionId: ctx.divisionId,
				perPage: 50,
			});
			return { ok: true, data: items.map((e) => slimEvent(e as unknown as Record<string, unknown>)) };
		},
	},
	{
		name: "get_forms",
		description: "Lihat daftar form milik divisi user (termasuk draft).",
		input_schema: { type: "object", properties: {} },
		kind: "read",
		permission: "forms.read",
		run: async (ctx) => {
			const { items } = await formService.listAdmin(ctx.db, {
				divisionId: ctx.divisionId,
				perPage: 50,
			});
			return { ok: true, data: items.map((f) => slimForm(f as unknown as Record<string, unknown>)) };
		},
	},
	{
		name: "create_event",
		description:
			"Usulkan event BARU (selalu draft, bukan publish). Butuh: title, starts_at, ends_at (ISO 8601 +07:00), location. Opsional: description, cover_image_url, location_url, registration_url, organizer, sessions[] (name, starts_at, ends_at, speaker?, location?).",
		input_schema: {
			type: "object",
			properties: {
				title: { type: "string" },
				description: { type: "string" },
				starts_at: { type: "string", description: "ISO 8601 dengan offset, mis. 2026-09-20T08:00:00+07:00" },
				ends_at: { type: "string" },
				location: { type: "string" },
				location_url: { type: "string" },
				registration_url: { type: "string" },
				organizer: { type: "string" },
				sessions: {
					type: "array",
					items: {
						type: "object",
						properties: {
							name: { type: "string" },
							starts_at: { type: "string" },
							ends_at: { type: "string" },
							speaker: { type: "string" },
							location: { type: "string" },
							description: { type: "string" },
						},
						required: ["name", "starts_at", "ends_at"],
					},
				},
			},
			required: ["title", "starts_at", "ends_at", "location"],
		},
		kind: "write",
		permission: "events.create",
		validate: createEventSchema,
		run: async () => ({ ok: true, data: null }), // dieksekusi lewat confirm, bukan di sini
	},
	{
		name: "create_form",
		description:
			"Usulkan form BARU (selalu draft). Butuh: title, fields[] (label, type, required, options utk choice). Tipe field valid: short_text, paragraph, email, number, multiple_choice, checkboxes, dropdown, linear_scale, date, file. Opsional: description, opens_at, closes_at, thank_you_message.",
		input_schema: {
			type: "object",
			properties: {
				title: { type: "string" },
				description: { type: "string" },
				opens_at: { type: "string" },
				closes_at: { type: "string" },
				thank_you_message: { type: "string" },
				fields: {
					type: "array",
					items: {
						type: "object",
						properties: {
							label: { type: "string" },
							description: { type: "string" },
							type: {
								type: "string",
								enum: [
									"short_text",
									"paragraph",
									"email",
									"number",
									"multiple_choice",
									"checkboxes",
									"dropdown",
									"linear_scale",
									"date",
									"file",
								],
							},
							required: { type: "boolean" },
							options: {
								oneOf: [
									{ type: "array", items: { type: "string" } },
									{ type: "object", properties: { min: { type: "number" }, max: { type: "number" } } },
								],
							},
						},
						required: ["label", "type"],
					},
				},
			},
			required: ["title", "fields"],
		},
		kind: "write",
		permission: "forms.create",
		validate: createFormSchema,
		run: async () => ({ ok: true, data: null }), // dieksekusi lewat confirm
	},
];

export const toolByName = (name: string) => TOOLS.find((t) => t.name === name);

// Definisi untuk Anthropic tools parameter.
export const llmToolDefs = () =>
	TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));

// Cek permission dengan pola shared/permissions — base + scope. platform_admin
// (".all") selalu lolos; divisi dicek own_division + kecocokan divisi aktif.
export const canUseTool = (
	permissions: string[],
	tool: ToolEntry,
	opts: { isOwnDivision: boolean },
): boolean => {
	const base = tool.permission; // "events.create" dll
	return (
		permissions.includes(`${base}.all`) ||
		(opts.isOwnDivision && permissions.includes(`${base}.own_division`))
	);
};
