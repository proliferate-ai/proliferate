import { createLogger } from "@proliferate/logger";
import { betterAuth } from "better-auth";
import { apiKey, organization } from "better-auth/plugins";
import { Pool } from "pg";

const log = createLogger({ service: "auth-core" });

export interface AuthOptions {
	/** PostgreSQL connection pool. If not provided, creates one from DATABASE_URL. */
	pool?: Pool;
	/** Base URL for auth routes (e.g., "http://localhost:3000"). */
	baseURL?: string;
	/** Better Auth secret. Defaults to BETTER_AUTH_SECRET env var. */
	secret?: string;
	/** Trusted origins for CORS. */
	trustedOrigins?: string[];
	/** Social provider credentials. */
	socialProviders?: {
		github?: { clientId: string; clientSecret: string };
		google?: { clientId: string; clientSecret: string };
	};
	/** Email/password config. */
	emailAndPassword?: {
		enabled?: boolean;
		minPasswordLength?: number;
		requireEmailVerification?: boolean;
	};
	/** Email verification config. */
	emailVerification?: {
		sendOnSignUp?: boolean;
		autoSignInAfterVerification?: boolean;
		sendVerificationEmail?: (data: {
			user: { email: string; name: string };
			url: string;
		}) => Promise<void>;
	};
	/** Organization invitation email sender. */
	sendInvitationEmail?: (data: any) => Promise<void>;
	/** Optional user create before hook (e.g., allowlist check). */
	onUserCreateBefore?: (user: any) => Promise<{ data: any }>;
	/** Optional user create after hook (e.g., CRM identification). */
	onUserCreateAfter?: (user: any) => Promise<void>;
	/** Allowed signup emails (comma-separated or array). When set, only these can sign up. */
	allowedSignupEmails?: string[] | null;
}

function resolvePool(options?: AuthOptions): Pool {
	if (options?.pool) return options.pool;

	const isLocal =
		!process.env.DATABASE_URL?.includes("amazonaws.com") &&
		!process.env.DATABASE_URL?.includes("neon.tech");
	const isDev = process.env.NODE_ENV !== "production";

	return new Pool({
		connectionString: process.env.DATABASE_URL,
		max: isDev ? 5 : 1,
		idleTimeoutMillis: 10000,
		connectionTimeoutMillis: isDev ? 60000 : 5000,
		keepAlive: isDev,
		ssl: isLocal ? false : { rejectUnauthorized: false },
	});
}

export function createAuth(options: AuthOptions = {}) {
	const pool = resolvePool(options);
	const baseURL = options.baseURL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
	const secret = options.secret ?? process.env.BETTER_AUTH_SECRET ?? "";

	const emailPasswordEnabled = options.emailAndPassword?.enabled ?? true;
	const requireEmailVerification = options.emailAndPassword?.requireEmailVerification ?? false;

	const allowedSignupEmails =
		options.allowedSignupEmails ??
		(process.env.ALLOWED_SIGNUP_EMAILS
			? process.env.ALLOWED_SIGNUP_EMAILS.split(",")
					.map((e) => e.trim().toLowerCase())
					.filter(Boolean)
			: null);

	// Build social providers from options or env
	const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};

	const githubId = options.socialProviders?.github?.clientId ?? process.env.GITHUB_OAUTH_APP_ID;
	const githubSecret =
		options.socialProviders?.github?.clientSecret ?? process.env.GITHUB_OAUTH_APP_SECRET;
	if (githubId && githubSecret) {
		socialProviders.github = { clientId: githubId, clientSecret: githubSecret };
	}

	const googleId = options.socialProviders?.google?.clientId ?? process.env.GOOGLE_CLIENT_ID;
	const googleSecret =
		options.socialProviders?.google?.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET;
	if (googleId && googleSecret) {
		socialProviders.google = { clientId: googleId, clientSecret: googleSecret };
	}

	const trustedOrigins = (
		options.trustedOrigins ?? ["http://localhost:3000", baseURL, "*.ngrok-free.dev", "*.ngrok.app"]
	).filter(Boolean) as string[];

	const auth = betterAuth({
		database: pool,
		baseURL,
		secret,
		trustedOrigins,

		emailAndPassword: {
			enabled: emailPasswordEnabled,
			minPasswordLength: options.emailAndPassword?.minPasswordLength ?? 8,
			requireEmailVerification,
		},

		...(requireEmailVerification && options.emailVerification
			? {
					emailVerification: {
						sendOnSignUp: options.emailVerification.sendOnSignUp ?? true,
						autoSignInAfterVerification:
							options.emailVerification.autoSignInAfterVerification ?? true,
						sendVerificationEmail: options.emailVerification.sendVerificationEmail,
					},
				}
			: {}),

		socialProviders,

		plugins: [
			apiKey({ rateLimit: { enabled: false } }),
			organization({
				allowUserToCreateOrganization: true,
				creatorRole: "owner",
				invitationExpiresIn: 7 * 24 * 60 * 60,
				...(options.sendInvitationEmail
					? { sendInvitationEmail: options.sendInvitationEmail }
					: {}),
			}),
		],

		session: {
			expiresIn: 60 * 60 * 24 * 7,
			updateAge: 60 * 60 * 24,
		},

		databaseHooks: {
			user: {
				create: {
					before: async (user) => {
						if (allowedSignupEmails && !allowedSignupEmails.includes(user.email.toLowerCase())) {
							throw new Error(
								"Signups are currently invite-only. Join the waitlist at proliferate.com/waitlist",
							);
						}
						if (options.onUserCreateBefore) {
							return options.onUserCreateBefore(user);
						}
						return { data: user };
					},
					after: async (user) => {
						const slug = user.name
							.toLowerCase()
							.replace(/[^a-z0-9]+/g, "-")
							.replace(/^-|-$/g, "");

						try {
							await pool.query(
								`INSERT INTO "organization" (id, name, slug, "createdAt")
								 VALUES ($1, $2, $3, NOW())
								 ON CONFLICT (slug) DO NOTHING`,
								[`org_${user.id}`, `${user.name}'s Workspace`, `${slug}-${user.id.slice(0, 8)}`],
							);

							await pool.query(
								`INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt")
								 VALUES ($1, $2, $3, 'owner', NOW())`,
								[`mem_${user.id}`, `org_${user.id}`, user.id],
							);
						} catch (error) {
							log.error({ err: error }, "Failed to create default organization");
						}

						if (options.onUserCreateAfter) {
							await options.onUserCreateAfter(user);
						}
					},
				},
			},
			session: {
				create: {
					before: async (session) => {
						const result = await pool.query(
							`SELECT "organizationId" FROM "member" WHERE "userId" = $1 LIMIT 1`,
							[session.userId],
						);

						if (result.rows.length > 0) {
							return {
								data: {
									...session,
									activeOrganizationId: result.rows[0].organizationId,
								},
							};
						}
						return { data: session };
					},
				},
			},
		},
	});

	return auth;
}

export type Auth = ReturnType<typeof createAuth>;
