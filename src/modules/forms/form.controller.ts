import type { Context } from "hono";
import { ApiResponse } from "../../shared/api-response";
import { ApiError } from "../../shared/api-error";
import { parseJson, parseParams } from "../../shared/parse-request";
import { getDb } from "../../db/connection";
import { formService } from "./form.service";
import { recordAuditLog } from "../audit/audit.service";
import {
	createFormSchema,
	idParamSchema,
	listSubmissionsQuerySchema,
	updateFormSchema,
	updateSubmissionSchema,
} from "./form.schema";
import type { AppContext } from "../../types";

type Ctx = Context<AppContext>;

export const listForms = async (c: Ctx) => {
	const isAll = (c.get("permissions") ?? []).includes("forms.read.all");
	const result = await formService.listAdmin(getDb(c.env.DB), {
		divisionId: isAll ? undefined : c.get("activeDivisionId"),
	});
	return ApiResponse.ok(c, "OK", result);
};

export const createForm = async (c: Ctx) => {
	const input = await parseJson(c, createFormSchema);
	const result = await formService.create(getDb(c.env.DB), input, {
		divisionId: c.get("activeDivisionId"),
		userId: c.get("userId"),
	});
	await recordAuditLog(c, {
		action: "forms.create",
		resourceType: "form",
		resourceId: result.id,
		metadata: { title: result.title, slug: result.slug, divisionId: c.get("activeDivisionId") },
	});
	return ApiResponse.created(c, "Form created", result);
};

export const getForm = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	return ApiResponse.ok(c, "OK", await formService.get(getDb(c.env.DB), id));
};

export const updateForm = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	const input = await parseJson(c, updateFormSchema);
	const result = await formService.update(getDb(c.env.DB), id, input);
	await recordAuditLog(c, {
		action: "forms.update",
		resourceType: "form",
		resourceId: id,
	});
	return ApiResponse.ok(c, "Form updated", result);
};

export const deleteForm = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	const deleted = await formService.delete(getDb(c.env.DB), id);
	await recordAuditLog(c, {
		action: "forms.delete",
		resourceType: "form",
		resourceId: id,
		metadata: { title: deleted.title, slug: deleted.slug },
	});
	return ApiResponse.ok(c, "Form deleted");
};

export const publishForm = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	const result = await formService.setStatus(getDb(c.env.DB), id, "published");
	await recordAuditLog(c, { action: "forms.publish", resourceType: "form", resourceId: id });
	return ApiResponse.ok(c, "Form published", result);
};

export const unpublishForm = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	const result = await formService.setStatus(getDb(c.env.DB), id, "draft");
	await recordAuditLog(c, { action: "forms.unpublish", resourceType: "form", resourceId: id });
	return ApiResponse.ok(c, "Form unpublished", result);
};

export const closeForm = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	const result = await formService.setStatus(getDb(c.env.DB), id, "closed");
	await recordAuditLog(c, { action: "forms.close", resourceType: "form", resourceId: id });
	return ApiResponse.ok(c, "Form closed", result);
};

export const formAnalytics = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	return ApiResponse.ok(c, "OK", await formService.analytics(getDb(c.env.DB), id));
};

export const listSubmissions = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	const query = listSubmissionsQuerySchema.safeParse({
		page: c.req.query("page") ?? undefined,
		per_page: c.req.query("per_page") ?? undefined,
	});
	if (!query.success) throw ApiError.badRequest("Invalid query parameters");
	return ApiResponse.ok(c, "OK", await formService.listSubmissions(getDb(c.env.DB), id, query.data.page, query.data.per_page));
};

export const updateSubmission = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	const input = await parseJson(c, updateSubmissionSchema);
	return ApiResponse.ok(c, "Submission updated", await formService.updateSubmissionStatus(getDb(c.env.DB), id, input.status));
};

export const deleteSubmission = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	await formService.deleteSubmission(getDb(c.env.DB), id);
	await recordAuditLog(c, { action: "forms.submission_delete", resourceType: "submission", resourceId: id });
	return ApiResponse.ok(c, "Submission deleted");
};
