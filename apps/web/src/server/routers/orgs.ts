/**
 * Orgs oRPC router.
 *
 * Handles organization operations including members and invitations.
 */

import { ORPCError } from "@orpc/server";
import { orgs } from "@proliferate/services";
import {
	DomainSuggestionSchema,
	InvitationSchema,
	MemberSchema,
	OrgRoleSchema,
	OrganizationSchema,
	OrganizationWithRoleSchema,
} from "@proliferate/shared";
import { z } from "zod";
import { orgProcedure, protectedProcedure } from "./middleware";

export const orgsRouter = {
	/**
	 * List all organizations the current user belongs to.
	 */
	list: protectedProcedure
		.input(z.object({}).optional())
		.output(z.object({ orgs: z.array(OrganizationWithRoleSchema) }))
		.handler(async ({ context }) => {
			const orgsList = await orgs.listOrgs(context.user.id);
			return { orgs: orgsList };
		}),

	/**
	 * Get a single organization by ID.
	 */
	get: orgProcedure
		.input(z.object({ id: z.string() }))
		.output(OrganizationSchema)
		.handler(async ({ input, context }) => {
			const org = await orgs.getOrg(input.id, context.user.id);
			if (!org) {
				throw new ORPCError("NOT_FOUND", { message: "Organization not found" });
			}
			return org;
		}),

	/**
	 * List all members of an organization.
	 */
	listMembers: orgProcedure
		.input(z.object({ id: z.string() }))
		.output(z.array(MemberSchema))
		.handler(async ({ input, context }) => {
			const members = await orgs.listMembers(input.id, context.user.id);
			if (members === null) {
				throw new ORPCError("FORBIDDEN", { message: "Not a member of this organization" });
			}
			return members;
		}),

	/**
	 * List pending invitations for an organization.
	 */
	listInvitations: orgProcedure
		.input(z.object({ id: z.string() }))
		.output(z.array(InvitationSchema))
		.handler(async ({ input, context }) => {
			const invitations = await orgs.listInvitations(input.id, context.user.id);
			if (invitations === null) {
				throw new ORPCError("FORBIDDEN", { message: "Not a member of this organization" });
			}
			return invitations;
		}),

	/**
	 * Get members and invitations in one request.
	 * Optimized for the team settings page.
	 */
	getMembersAndInvitations: orgProcedure
		.input(z.object({ id: z.string() }))
		.output(
			z.object({
				members: z.array(MemberSchema),
				invitations: z.array(InvitationSchema),
				currentUserRole: OrgRoleSchema,
			}),
		)
		.handler(async ({ input, context }) => {
			const result = await orgs.getMembersAndInvitations(input.id, context.user.id);
			if (result === null) {
				throw new ORPCError("FORBIDDEN", { message: "Not a member of this organization" });
			}
			return result;
		}),

	/**
	 * Get organizations matching user's email domain for auto-join.
	 */
	getDomainSuggestions: protectedProcedure
		.input(z.object({}).optional())
		.output(
			z.object({
				suggestions: z.array(DomainSuggestionSchema),
				domain: z.string().optional(),
			}),
		)
		.handler(async ({ context }) => {
			const result = await orgs.getDomainSuggestions(context.user.id, context.user.email);
			return result;
		}),
};
