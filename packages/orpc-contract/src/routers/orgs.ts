import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	InvitationSchema,
	MemberSchema,
	MembersAndInvitationsSchema,
	OrganizationSchema,
	OrganizationWithRoleSchema,
} from "../schemas/orgs";

export const orgsContract = {
	list: oc
		.input(z.object({}).optional())
		.output(z.object({ orgs: z.array(OrganizationWithRoleSchema) })),

	get: oc.input(z.object({ id: z.string() })).output(OrganizationSchema),

	listMembers: oc.input(z.object({ id: z.string() })).output(z.array(MemberSchema)),

	listInvitations: oc.input(z.object({ id: z.string() })).output(z.array(InvitationSchema)),

	getMembersAndInvitations: oc
		.input(z.object({ id: z.string() }))
		.output(MembersAndInvitationsSchema),
};
