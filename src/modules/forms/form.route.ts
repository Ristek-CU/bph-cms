import { Hono } from "hono";
import { z } from "zod";
import { describeRoute, resolver } from "hono-openapi";
import type { AppContext } from "../../types";
import { adminAuth } from "../../middlewares/admin-auth";
import { requirePermission } from "../../middlewares/require-permission";
import { ApiResponse } from "../../shared/api-response";
import { recordAuditLog } from "../audit/audit.service";
import { getDb } from "../../db/connection";
import { formService } from "./form.service";
import { successWrapper, errorWrapper } from "../openapi/schemas";
import {
	listForms,
	createForm,
	getForm,
	updateForm,
	deleteForm,
	publishForm,
	unpublishForm,
	closeForm,
	formAnalytics,
	listSubmissions,
	updateSubmission,
	deleteSubmission,
} from "./form.controller";

const ok = (
	summary: string,
	description: string,
	responseSchema: z.ZodTypeAny,
	extra: Record<number, { description: string }> = {},
) =>
	describeRoute({
		summary,
		description,
		tags: ["Admin Forms"],
		security: [{ bearerAuth: [] }],
		responses: {
			200: { description: "Success", content: { "application/json": { schema: resolver(responseSchema) } } },
			401: { description: "Unauthorized", content: { "application/json": { schema: resolver(errorWrapper) } } },
			403: { description: "Forbidden (insufficient role)" },
			422: { description: "Validation error", content: { "application/json": { schema: resolver(errorWrapper) } } },
			...extra,
		},
	});

export const adminFormRouter = new Hono<AppContext>();

adminFormRouter.use("*", adminAuth);

adminFormRouter.get(
	"/",
	requirePermission("forms.read.own_division"),
	ok("List forms (admin, per divisi)", "division_admin: hanya form divisinya. platform_admin: semua.", successWrapper(z.array(z.object({})))),
	listForms,
);

adminFormRouter.post(
	"/",
	requirePermission("forms.create.own_division"),
	ok("Create form (draft)", "Slug auto dari judul bila kosong. Fields inline optional. 201 → form lengkap.", successWrapper(z.object({})), {
		201: { description: "Created" },
	}),
	createForm,
);

adminFormRouter.get(
	"/:id",
	requirePermission("forms.read.own_division", { resourceType: "form" }),
	ok("Get form detail", "Form + fields.", successWrapper(z.object({})), { 404: { description: "Not found" } }),
	getForm,
);

adminFormRouter.put(
	"/:id",
	requirePermission("forms.update.own_division", { resourceType: "form" }),
	ok("Update form (partial)", "Body parsial. Jika fields dikirim, seluruh set pertanyaan diganti — jawaban historis tetap (snapshot label).", successWrapper(z.object({})), {
		404: { description: "Not found" },
	}),
	updateForm,
);

adminFormRouter.delete(
	"/:id",
	requirePermission("forms.delete.own_division", { resourceType: "form" }),
	ok("Delete form", "Ditolak 409 bila masih punya respons tersimpan.", successWrapper(z.object({})), {
		404: { description: "Not found" },
		409: { description: "Masih ada submissions" },
	}),
	deleteForm,
);

adminFormRouter.post(
	"/:id/publish",
	requirePermission("forms.publish.own_division", { resourceType: "form" }),
	ok("Publish form", "Form terlihat di endpoint publik /forms/:slug.", successWrapper(z.object({})), { 404: { description: "Not found" } }),
	publishForm,
);

adminFormRouter.post(
	"/:id/unpublish",
	requirePermission("forms.publish.own_division", { resourceType: "form" }),
	ok("Unpublish form (kembali ke draft)", "Publik kembali 404.", successWrapper(z.object({}))),
	unpublishForm,
);

adminFormRouter.post(
	"/:id/close",
	requirePermission("forms.publish.own_division", { resourceType: "form" }),
	ok("Close form", "Form masih terlihat publik tapi menolak respons baru (409).", successWrapper(z.object({}))),
	closeForm,
);

adminFormRouter.get(
	"/:id/analytics",
	requirePermission("forms.read.own_division", { resourceType: "form" }),
	ok("Form analytics", "Total respons, tren 7 hari, distribusi per pilihan, rata-rata skala/angka.", successWrapper(z.object({})), {
		404: { description: "Not found" },
	}),
	formAnalytics,
);

adminFormRouter.get(
	"/:id/submissions",
	requirePermission("forms.submissions.own_division", { resourceType: "form" }),
	ok("List submissions", "Query: page, per_page (default 20, max 100).", successWrapper(z.object({})), {
		404: { description: "Not found" },
	}),
	listSubmissions,
);

// Submissions by id — route terpisah biar param :id tidak menabrak form id.
const submissionRouter = new Hono<AppContext>();
submissionRouter.use("*", adminAuth);
submissionRouter.put(
	"/:id",
	requirePermission("forms.submissions.own_division", { resourceType: "submission" }),
	ok("Update submission status", "Body: { status: new|reviewed|archived }", successWrapper(z.object({}))),
	updateSubmission,
);
submissionRouter.delete(
	"/:id",
	requirePermission("forms.submissions.own_division", { resourceType: "submission" }),
	ok("Delete submission", "Hapus permanen jawaban + metadata file di DB (file R2 tetap).", successWrapper(z.object({}))),
	deleteSubmission,
);

export const adminFormSubmissionRouter = submissionRouter;
