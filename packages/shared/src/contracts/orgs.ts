import { initContract } from "@ts-rest/core";
import { z } from "zod";
import { ErrorResponseSchema } from "./common";

const c = initContract();

// ============================================
// Schemas
// ============================================

export const OrgRoleSchema = z.enum(["owner", "admin", "member"]);
export type OrgRole = z.infer<typeof OrgRoleSchema>;

export const OrganizationSchema = z.object({
	id: z.string(),
	name: z.string(),
	slug: z.string(),
	logo: z.string().nullable(),
	is_personal: z.boolean().nullable(),
	allowed_domains: z.array(z.string()).nullable(),
	createdAt: z.string(),
});

export const OrganizationWithRoleSchema = OrganizationSchema.extend({
	role: OrgRoleSchema,
});

export type Organization = z.infer<typeof OrganizationSchema>;
export type OrganizationWithRole = z.infer<typeof OrganizationWithRoleSchema>;

export const MemberUserSchema = z.object({
	id: z.string(),
	name: z.string().nullable(),
	email: z.string(),
	image: z.string().nullable(),
});

export const MemberSchema = z.object({
	id: z.string(),
	userId: z.string(),
	role: OrgRoleSchema,
	createdAt: z.string(),
	user: MemberUserSchema.nullable(),
});

export type Member = z.infer<typeof MemberSchema>;

export const InviterSchema = z.object({
	name: z.string().nullable(),
	email: z.string(),
});

export const InvitationSchema = z.object({
	id: z.string(),
	email: z.string(),
	role: OrgRoleSchema,
	status: z.string(),
	expiresAt: z.string(),
	createdAt: z.string(),
	inviter: InviterSchema.nullable(),
});

export type Invitation = z.infer<typeof InvitationSchema>;

export const DomainSuggestionSchema = z.object({
	id: z.string(),
	name: z.string(),
	slug: z.string(),
	logo: z.string().nullable(),
});

// ============================================
// Contract
// ============================================

export const orgsContract = c.router(
	{
		list: {
			method: "GET",
			path: "/orgs",
			responses: {
				200: z.object({ orgs: z.array(OrganizationWithRoleSchema) }),
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "List organizations the current user belongs to",
		},

		get: {
			method: "GET",
			path: "/orgs/:id",
			pathParams: z.object({
				id: z.string(),
			}),
			responses: {
				200: OrganizationSchema,
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
			},
			summary: "Get organization details",
		},

		listMembers: {
			method: "GET",
			path: "/orgs/:id/members",
			pathParams: z.object({
				id: z.string(),
			}),
			responses: {
				200: z.array(MemberSchema),
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "List organization members",
		},

		listInvitations: {
			method: "GET",
			path: "/orgs/:id/invitations",
			pathParams: z.object({
				id: z.string(),
			}),
			responses: {
				200: z.array(InvitationSchema),
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "List pending invitations",
		},

		getMembersAndInvitations: {
			method: "GET",
			path: "/orgs/:id/members-and-invitations",
			pathParams: z.object({
				id: z.string(),
			}),
			responses: {
				200: z.object({
					members: z.array(MemberSchema),
					invitations: z.array(InvitationSchema),
					currentUserRole: OrgRoleSchema,
				}),
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Get members and invitations in one request",
		},

		updateDomains: {
			method: "PATCH",
			path: "/orgs/:id/domains",
			pathParams: z.object({
				id: z.string(),
			}),
			body: z.object({
				allowed_domains: z.array(z.string()),
			}),
			responses: {
				200: z.object({ allowed_domains: z.array(z.string()) }),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Update allowed domains for auto-join (owner only)",
		},

		updateMemberRole: {
			method: "PATCH",
			path: "/orgs/:id/members/:memberId",
			pathParams: z.object({
				id: z.string(),
				memberId: z.string(),
			}),
			body: z.object({
				role: z.enum(["admin", "member"]),
			}),
			responses: {
				200: z.object({ success: z.boolean() }),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Update member role (owner only)",
		},

		removeMember: {
			method: "DELETE",
			path: "/orgs/:id/members/:memberId",
			pathParams: z.object({
				id: z.string(),
				memberId: z.string(),
			}),
			body: c.noBody(),
			responses: {
				200: z.object({ success: z.boolean() }),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Remove member from organization (owner only)",
		},

		getDomainSuggestions: {
			method: "GET",
			path: "/orgs/domain-suggestions",
			responses: {
				200: z.object({
					suggestions: z.array(DomainSuggestionSchema),
					domain: z.string().optional(),
				}),
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Get organizations matching user's email domain for auto-join",
		},
	},
	{
		pathPrefix: "/api",
	},
);
