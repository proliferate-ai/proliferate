/**
 * Auth oRPC router.
 *
 * Auth-related read endpoints used by the web client.
 */

import { ORPCError } from "@orpc/server";
import { env } from "@proliferate/environment/server";
import { SignJWT } from "jose";
import { z } from "zod";
import { protectedProcedure, publicProcedure } from "./middleware";

const TOKEN_LIFETIME = "1h";

const AuthProvidersSchema = z.object({
	providers: z.object({
		google: z.boolean(),
		github: z.boolean(),
		email: z.boolean(),
	}),
});

export const authRouter = {
	/**
	 * Returns which auth providers are configured.
	 */
	providers: publicProcedure
		.input(z.object({}).optional())
		.output(AuthProvidersSchema)
		.handler(async () => ({
			providers: {
				google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
				github: Boolean(env.GITHUB_OAUTH_APP_ID && env.GITHUB_OAUTH_APP_SECRET),
				email: true,
			},
		})),

	/**
	 * Generates a short-lived JWT for Gateway WebSocket auth.
	 */
	wsToken: protectedProcedure
		.input(z.object({}).optional())
		.output(z.object({ token: z.string() }))
		.handler(async ({ context }) => {
			if (!env.GATEWAY_JWT_SECRET) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Server misconfigured" });
			}

			const token = await new SignJWT({
				sub: context.user.id,
				email: context.user.email || undefined,
				orgId: context.session.activeOrganizationId || undefined,
			})
				.setProtectedHeader({ alg: "HS256" })
				.setIssuedAt()
				.setExpirationTime(TOKEN_LIFETIME)
				.sign(new TextEncoder().encode(env.GATEWAY_JWT_SECRET));

			return { token };
		}),
};
