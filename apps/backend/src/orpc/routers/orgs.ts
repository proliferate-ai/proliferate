/**
 * Orgs router implementation.
 *
 * Implements the orgs contract procedures.
 */

import { ORPCError } from "@orpc/server";
import { orgs } from "@proliferate/services";
import { orpc } from "../contract";
import { orgMiddleware, protectedMiddleware } from "../middleware";

export const orgsRouter = {
	list: orpc.orgs.list.use(protectedMiddleware).handler(async ({ context }) => {
		const orgsList = await orgs.listOrgs(context.user.id);
		return { orgs: orgsList };
	}),

	get: orpc.orgs.get.use(orgMiddleware).handler(async ({ input, context }) => {
		const org = await orgs.getOrg(input.id, context.user.id);
		if (!org) {
			throw new ORPCError("NOT_FOUND", { message: "Organization not found" });
		}
		return org;
	}),

	listMembers: orpc.orgs.listMembers.use(orgMiddleware).handler(async ({ input, context }) => {
		const members = await orgs.listMembers(input.id, context.user.id);
		if (members === null) {
			throw new ORPCError("FORBIDDEN", { message: "Not a member of this organization" });
		}
		return members;
	}),

	listInvitations: orpc.orgs.listInvitations
		.use(orgMiddleware)
		.handler(async ({ input, context }) => {
			const invitations = await orgs.listInvitations(input.id, context.user.id);
			if (invitations === null) {
				throw new ORPCError("FORBIDDEN", { message: "Not a member of this organization" });
			}
			return invitations;
		}),

	getMembersAndInvitations: orpc.orgs.getMembersAndInvitations
		.use(orgMiddleware)
		.handler(async ({ input, context }) => {
			const result = await orgs.getMembersAndInvitations(input.id, context.user.id);
			if (result === null) {
				throw new ORPCError("FORBIDDEN", { message: "Not a member of this organization" });
			}
			return result;
		}),
};
