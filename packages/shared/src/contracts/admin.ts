import { initContract } from "@ts-rest/core";
import { z } from "zod";
import { ErrorResponseSchema } from "./common";

const c = initContract();

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

// ============================================
// Contract
// ============================================

export const adminContract = c.router(
	{
		getStatus: {
			method: "GET",
			path: "/admin/status",
			responses: {
				200: z.object({
					isSuperAdmin: z.boolean(),
					impersonating: ImpersonatingSchema.nullable().optional(),
				}),
				401: ErrorResponseSchema,
			},
			summary: "Get admin status and current impersonation state",
		},

		listUsers: {
			method: "GET",
			path: "/admin/users",
			responses: {
				200: z.object({ users: z.array(AdminUserSchema) }),
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "List all users (super admin only)",
		},

		listOrganizations: {
			method: "GET",
			path: "/admin/organizations",
			responses: {
				200: z.object({ organizations: z.array(AdminOrganizationSchema) }),
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "List all organizations (super admin only)",
		},

		impersonate: {
			method: "POST",
			path: "/admin/impersonate",
			body: z.object({
				userId: z.string(),
				orgId: z.string(),
			}),
			responses: {
				200: z.object({
					success: z.boolean(),
					impersonating: z.object({
						user: ImpersonatingUserSchema,
						org: ImpersonatingOrgSchema,
					}),
				}),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
			summary: "Start impersonating a user (super admin only)",
		},

		stopImpersonate: {
			method: "POST",
			path: "/admin/stop-impersonate",
			body: c.noBody(),
			responses: {
				200: z.object({ success: z.boolean() }),
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
			},
			summary: "Stop impersonating (super admin only)",
		},

		switchOrg: {
			method: "POST",
			path: "/admin/switch-org",
			body: z.object({
				orgId: z.string(),
			}),
			responses: {
				200: z.object({ success: z.boolean() }),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
			},
			summary: "Switch organization while impersonating (super admin only)",
		},
	},
	{
		pathPrefix: "/api",
	},
);
