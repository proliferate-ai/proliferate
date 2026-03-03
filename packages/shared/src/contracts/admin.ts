import { z } from "zod";

// ============================================
// Schemas
// ============================================

export const AdminUserOrgSchema = z.object({
	organizationId: z.string(),
	role: z.string(),
	organization: z
		.object({
			id: z.string(),
			name: z.string(),
		})
		.nullable(),
});

export const AdminUserSchema = z.object({
	id: z.string(),
	email: z.string(),
	name: z.string().nullable(),
	createdAt: z.string(),
	member: z.array(AdminUserOrgSchema).optional(),
});

export const AdminOrganizationSchema = z.object({
	id: z.string(),
	name: z.string(),
	slug: z.string(),
	isPersonal: z.boolean().nullable(),
	createdAt: z.string(),
	memberCount: z.number(),
});

export const ImpersonatingUserSchema = z.object({
	id: z.string(),
	email: z.string(),
	name: z.string().nullable(),
});

export const ImpersonatingOrgSchema = z.object({
	id: z.string(),
	name: z.string(),
});

export const UserOrgSchema = z.object({
	id: z.string(),
	name: z.string(),
	role: z.string(),
});

export const ImpersonatingSchema = z.object({
	user: ImpersonatingUserSchema,
	org: ImpersonatingOrgSchema,
	userOrgs: z.array(UserOrgSchema).optional(),
});
