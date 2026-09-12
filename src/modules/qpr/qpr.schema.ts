import { z } from "zod";

export const qprQuestionSchema = z.object({
	label: z.string().min(1).max(300),
	category: z.string().min(1).max(100),
});
export type QprQuestion = z.infer<typeof qprQuestionSchema>;

export const createPeriodSchema = z.object({
	title: z.string().min(1).max(200),
	questions: z.array(qprQuestionSchema).min(1).max(50),
	opens_at: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/)
		.nullish(),
	closes_at: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/)
		.nullish(),
});
export type CreatePeriodInput = z.infer<typeof createPeriodSchema>;

export const updatePeriodSchema = createPeriodSchema.partial();

export const createAssignmentsSchema = z.object({
	assignments: z
		.array(
			z.object({
				reviewer_user_id: z.string().min(1).max(100),
				reviewer_email: z.string().email().max(200),
				reviewee_name: z.string().min(1).max(200),
				reviewee_role: z.string().max(200).nullish(),
			}),
		)
		.min(1)
		.max(500),
});

export const submitAnswersSchema = z.object({
	answers: z
		.array(
			z.object({
				label: z.string().min(1).max(300),
				category: z.string().min(1).max(100),
				score: z.number().int().min(1).max(5),
				note: z.string().max(2000).nullish(),
			}),
		)
		.min(1)
		.max(50),
});
export type SubmitAnswersInput = z.infer<typeof submitAnswersSchema>;
