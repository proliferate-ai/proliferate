/**
 * Auth router implementation.
 *
 * Implements the auth contract procedures.
 */

import { orpc } from "../contract";

export const authRouter = {
	providers: orpc.auth.providers.handler(async () => ({
		providers: {
			google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
			github: Boolean(process.env.GITHUB_OAUTH_APP_ID && process.env.GITHUB_OAUTH_APP_SECRET),
			email: true,
		},
	})),
};
