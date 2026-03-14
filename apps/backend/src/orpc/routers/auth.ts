/**
 * Auth router implementation.
 *
 * Implements the auth contract procedures.
 */

import { orpc } from "../contract";
import { resolveSession } from "../middleware";

export const authRouter = {
	providers: orpc.auth.providers.handler(async () => ({
		providers: {
			google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
			github: Boolean(process.env.GITHUB_OAUTH_APP_ID && process.env.GITHUB_OAUTH_APP_SECRET),
			email: true,
		},
	})),

	wsToken: orpc.auth.wsToken
		.use(async ({ context, next }) => {
			const session = await resolveSession(context.request);
			return next({ context: { user: session.user, session: session.session } });
		})
		.handler(async ({ context }) => {
			// Placeholder -- WS token signing will be implemented when the
			// gateway ingress layer is added to the backend.
			return { token: `placeholder-${context.user.id}` };
		}),
};
