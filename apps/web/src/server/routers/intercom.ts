/**
 * Intercom oRPC router.
 *
 * Handles Intercom identity verification for secure user identification.
 */

import { createHmac } from "node:crypto";
import { env } from "@proliferate/environment/server";
import { z } from "zod";
import { protectedProcedure } from "./middleware";

const INTERCOM_SECRET_KEY = env.INTERCOM_SECRET_KEY;

// ============================================
// Router
// ============================================

export const intercomRouter = {
	/**
	 * Get the HMAC hash for Intercom identity verification.
	 * This hash proves to Intercom that the user ID comes from your server.
	 */
	getUserHash: protectedProcedure
		.input(z.object({}).optional())
		.output(z.object({ userHash: z.string().nullable() }))
		.handler(async ({ context }) => {
			if (!INTERCOM_SECRET_KEY) {
				return { userHash: null };
			}

			const hmac = createHmac("sha256", INTERCOM_SECRET_KEY);
			hmac.update(context.user.id);
			const userHash = hmac.digest("hex");

			return { userHash };
		}),
};
