import { z } from "zod";

export const OrgRoleSchema = z.enum(["admin", "member"]);

export const OrganizationSchema = z.object({
	id: z.string(),
	name: z.string(),
	slug: z.string(),
	logo: z.string().nullable(),
	createdAt: z.coerce.date(),
	autumnCustomerId: z.string().nullable(),
});

export const OrganizationWithRoleSchema = OrganizationSchema.extend({
	role: OrgRoleSchema,
});

const MemberUserSchema = z.object({
	id: z.string(),
	name: z.string(),
	email: z.string(),
	image: z.string().nullable(),
});

export const MemberSchema = z.object({
	id: z.string(),
	organizationId: z.string(),
	userId: z.string(),
	role: OrgRoleSchema,
	createdAt: z.coerce.date(),
	user: MemberUserSchema.nullable(),
});

const InviterSchema = z.object({
	name: z.string().nullable(),
	email: z.string().nullable(),
});

export const InvitationSchema = z.object({
	id: z.string(),
	organizationId: z.string(),
	email: z.string(),
	role: OrgRoleSchema,
	status: z.string(),
	expiresAt: z.coerce.date(),
	createdAt: z.coerce.date(),
	inviterId: z.string(),
	inviter: InviterSchema.nullable(),
});

export const MembersAndInvitationsSchema = z.object({
	members: z.array(MemberSchema),
	invitations: z.array(InvitationSchema),
	currentUserRole: OrgRoleSchema,
});
