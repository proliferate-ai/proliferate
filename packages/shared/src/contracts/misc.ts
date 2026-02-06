import { initContract } from "@ts-rest/core";
import { z } from "zod";
import { ErrorResponseSchema } from "./common";

const c = initContract();

// ============================================
// Contract
// ============================================

export const miscContract = c.router(
	{
		getIntercomUserHash: {
			method: "GET",
			path: "/intercom/user-hash",
			responses: {
				200: z.object({
					userHash: z.string(),
				}),
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Get HMAC-SHA256 hash of user ID for Intercom identity verification",
		},

		getWsToken: {
			method: "GET",
			path: "/auth/ws-token",
			responses: {
				200: z.object({
					token: z.string(),
				}),
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Generate a short-lived JWT for WebSocket authentication to Gateway",
		},
	},
	{
		pathPrefix: "/api",
	},
);
