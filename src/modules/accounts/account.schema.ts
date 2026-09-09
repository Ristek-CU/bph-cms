import { z } from "zod";

/**
 * Role CMS Hub. Harus enum tertutup: kolom `role` di SQLite hanyalah TEXT, jadi
 * tanpa validasi di sini nilai apa pun bisa masuk dan menghasilkan membership
 * tanpa permission yang tidak bisa dibaca ulang oleh panel.
 */
export const cmsRoleSchema = z.enum([
	"platform_admin",
	"division_admin",
	"contributor",
	"viewer",
]);

export const createDivisionSchema = z.object({
	slug: z
		.string()
		.trim()
		.toLowerCase()
		.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be kebab-case")
		.min(2)
		.max(60),
	name: z.string().trim().min(1).max(120),
	email: z.email("Must be a valid email").max(254).nullish(),
});

export const createMembershipSchema = z.object({
	user_id: z.string().trim().min(1).max(100),
	user_email: z.email("Must be a valid email").max(254),
	division_id: z.string().trim().min(1).max(100),
	role: cmsRoleSchema,
});
