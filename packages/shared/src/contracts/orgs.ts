import { z } from "zod";

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
