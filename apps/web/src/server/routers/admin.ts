/**
 * Admin oRPC router.
 *
 * Handles super-admin operations including user listing,
 * organization listing, and impersonation.
 */

import { getSession } from "@/lib/auth-helpers";
import {
	clearImpersonationCookie,
	getImpersonationCookie,
	isSuperAdmin,
	setImpersonationCookie,
} from "@/lib/super-admin";
import { os, ORPCError } from "@orpc/server";
import { type EnvStatus, getEnvStatus } from "@proliferate/environment";
import { nodeEnv } from "@proliferate/environment/runtime";
import { admin } from "@proliferate/services";
import {
	AdminOrganizationSchema,
	AdminUserSchema,
	ImpersonatingOrgSchema,
	ImpersonatingSchema,
	ImpersonatingUserSchema,
} from "@proliferate/shared";
import { z } from "zod";

// ============================================
// Admin Context
// ============================================

interface AdminContext {
	user: {
		id: string;
		email: string;
		name: string;
	};
	sessionId: string;
}

// ============================================
// Admin Procedure (super admin only)
// ============================================

const adminProcedure = os.use(async ({ next }) => {
	const session = await getSession();

	if (!session?.user) {
		throw new ORPCError("UNAUTHORIZED", { message: "Unauthorized" });
	}

	if (!isSuperAdmin(session.user.email)) {
		throw new ORPCError("FORBIDDEN", { message: "Forbidden" });
	}

	return next({
		context: {
			user: session.user,
			sessionId: session.session.id,
		} satisfies AdminContext,
	});
});

// ============================================
// Router
// ============================================

export const adminRouter = {
	/**
	 * Get admin status and current impersonation state.
	 * This endpoint is accessible to any authenticated user to check
	 * if they are a super admin.
	 */
	getStatus: os
		.input(z.object({}).optional())
		.output(
			z.object({
				isSuperAdmin: z.boolean(),
				impersonating: ImpersonatingSchema.nullable().optional(),
			}),
		)
		.handler(async () => {
			const session = await getSession();

			if (!session?.user) {
				throw new ORPCError("UNAUTHORIZED", { message: "Unauthorized" });
			}

			const superAdmin = isSuperAdmin(session.user.email);

			if (!superAdmin) {
				return { isSuperAdmin: false };
			}

			const impersonationData = await getImpersonationCookie();
			const result = await admin.getAdminStatus(true, impersonationData);

			return {
				isSuperAdmin: true,
				impersonating: result.impersonating ?? null,
			};
		}),

	/**
	 * List all users with their organization memberships.
	 */
	listUsers: adminProcedure
		.input(z.object({}).optional())
		.output(z.object({ users: z.array(AdminUserSchema) }))
		.handler(async () => {
			const users = await admin.listUsers();
			return { users };
		}),

	/**
	 * List all organizations with member counts.
	 */
	listOrganizations: adminProcedure
		.input(z.object({}).optional())
		.output(z.object({ organizations: z.array(AdminOrganizationSchema) }))
		.handler(async () => {
			const organizations = await admin.listOrganizations();
			return { organizations };
		}),

	/**
	 * Get environment configuration status for settings UI.
	 * In production, this is restricted to super admins.
	 */
	configStatus: os
		.input(z.object({}).optional())
		.output(z.custom<EnvStatus>())
		.handler(async () => {
			const session = await getSession();
			if (!session?.user) {
				throw new ORPCError("UNAUTHORIZED", { message: "Unauthorized" });
			}

			if (nodeEnv === "production" && !isSuperAdmin(session.user.email)) {
				throw new ORPCError("FORBIDDEN", { message: "Forbidden" });
			}

			return getEnvStatus();
		}),

	/**
	 * Throw a server-side error intentionally for Sentry verification.
	 */
	sentryTestError: os.input(z.object({}).optional()).handler(async () => {
		throw new Error("Sentry Test: Server-side API error thrown intentionally!");
	}),

	/**
	 * Start impersonating a user in an organization.
	 */
	impersonate: adminProcedure
		.input(
			z.object({
				userId: z.string(),
				orgId: z.string(),
			}),
		)
		.output(
			z.object({
				success: z.boolean(),
				impersonating: z.object({
					user: ImpersonatingUserSchema,
					org: ImpersonatingOrgSchema,
				}),
			}),
		)
		.handler(async ({ input }) => {
			try {
				const result = await admin.impersonate(input.userId, input.orgId);

				await setImpersonationCookie({
					userId: input.userId,
					orgId: input.orgId,
				});

				return {
					success: true,
					impersonating: {
						user: result.user,
						org: result.org,
					},
				};
			} catch (error) {
				if (error instanceof admin.ImpersonationError) {
					if (error.code === "USER_NOT_FOUND") {
						throw new ORPCError("NOT_FOUND", { message: "User not found" });
					}
					if (error.code === "ORG_NOT_FOUND") {
						throw new ORPCError("NOT_FOUND", { message: "Organization not found" });
					}
					if (error.code === "NOT_A_MEMBER") {
						throw new ORPCError("BAD_REQUEST", {
							message: "User is not a member of this organization",
						});
					}
				}
				throw error;
			}
		}),

	/**
	 * Stop impersonating and return to normal admin view.
	 */
	stopImpersonate: adminProcedure
		.input(z.object({}).optional())
		.output(z.object({ success: z.boolean() }))
		.handler(async () => {
			await clearImpersonationCookie();
			return { success: true };
		}),

	/**
	 * Switch organization while impersonating a user.
	 */
	switchOrg: adminProcedure
		.input(z.object({ orgId: z.string() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			const impersonationData = await getImpersonationCookie();

			if (!impersonationData) {
				throw new ORPCError("BAD_REQUEST", { message: "Not currently impersonating" });
			}

			try {
				await admin.validateOrgSwitch(impersonationData.userId, input.orgId);

				await setImpersonationCookie({
					userId: impersonationData.userId,
					orgId: input.orgId,
				});

				return { success: true };
			} catch (error) {
				if (error instanceof admin.ImpersonationError) {
					if (error.code === "NOT_A_MEMBER") {
						throw new ORPCError("BAD_REQUEST", {
							message: "User is not a member of this organization",
						});
					}
				}
				throw error;
			}
		}),
};
