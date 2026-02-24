import { isEmailEnabled, sendInvitationEmail, sendVerificationEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { nextPhase } from "@proliferate/environment/runtime";
import { env, features } from "@proliferate/environment/server";
import { betterAuth } from "better-auth";
import { apiKey, organization } from "better-auth/plugins";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { Pool } from "pg";

const log = logger.child({ module: "auth" });

// During `next build`, env vars may be empty — provide safe fallbacks so
// better-auth's module-scope initialization doesn't crash the build.
const isBuild = nextPhase === PHASE_PRODUCTION_BUILD;
const appUrl = env.NEXT_PUBLIC_APP_URL ?? (isBuild ? "http://localhost:3000" : undefined);
const authSecret = env.BETTER_AUTH_SECRET ?? (isBuild ? "build-placeholder" : undefined);

const isLocalDb =
	env.DATABASE_URL?.includes("localhost") || env.DATABASE_URL?.includes("127.0.0.1");

// Prevent Next.js HMR from creating orphaned pools on every file save
const globalForAuthDb = globalThis as unknown as { authPool: Pool | undefined };

const pool =
	globalForAuthDb.authPool ??
	new Pool({
		connectionString: env.DATABASE_URL,
		max: features.isDev ? 5 : 1, // More connections for local dev; limit in serverless
		idleTimeoutMillis: 10000, // Close idle connections after 10s
		connectionTimeoutMillis: features.isDev ? 60000 : 5000, // Survive Next.js first-boot compile storm
		keepAlive: features.isDev,
		// Explicit ssl avoids the pg v8 deprecation warning about sslmode aliases.
		// RDS certs aren't in the default trust store, so rejectUnauthorized: false.
		ssl: isLocalDb ? false : { rejectUnauthorized: false },
	});

if (features.isDev) {
	globalForAuthDb.authPool = pool;
}

// When true, blocks login until email is verified and sends verification emails.
const sendVerificationEmails = Boolean(env.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION);

// Optional signup allowlist – when set, only these emails can create accounts.
const allowedSignupEmails = env.ALLOWED_SIGNUP_EMAILS
	? env.ALLOWED_SIGNUP_EMAILS.split(",")
			.map((e) => e.trim().toLowerCase())
			.filter(Boolean)
	: null;

export const auth = betterAuth({
	database: pool,
	baseURL: appUrl,
	secret: authSecret,

	// Trust localhost + ngrok origins (wildcards for any ngrok subdomain)
	trustedOrigins: ["http://localhost:3000", appUrl, "*.ngrok-free.dev", "*.ngrok.app"].filter(
		Boolean,
	) as string[],

	// Email/Password authentication
	emailAndPassword: {
		enabled: true,
		minPasswordLength: 8,
		requireEmailVerification: sendVerificationEmails, // Block login until email verified
	},

	// Email verification - must be at top level, not inside emailAndPassword
	...(sendVerificationEmails
		? {
				emailVerification: {
					sendOnSignUp: true,
					autoSignInAfterVerification: true,
					sendVerificationEmail: async ({ user, url }) => {
						if (!isEmailEnabled()) {
							throw new Error("Email is disabled but verification is required.");
						}
						await sendVerificationEmail(user, url);
					},
				},
			}
		: {}),

	// OAuth providers for user authentication (only enabled if credentials are provided)
	socialProviders: {
		...(env.GITHUB_OAUTH_APP_ID &&
			env.GITHUB_OAUTH_APP_SECRET && {
				github: {
					clientId: env.GITHUB_OAUTH_APP_ID,
					clientSecret: env.GITHUB_OAUTH_APP_SECRET,
				},
			}),
		...(env.GOOGLE_CLIENT_ID &&
			env.GOOGLE_CLIENT_SECRET && {
				google: {
					clientId: env.GOOGLE_CLIENT_ID,
					clientSecret: env.GOOGLE_CLIENT_SECRET,
				},
			}),
	},

	// Plugins for organization and API key support
	plugins: [
		// API key plugin for CLI authentication (rate limiting disabled for CLI usage)
		apiKey({
			rateLimit: {
				enabled: false,
			},
		}),
		organization({
			allowUserToCreateOrganization: true,
			creatorRole: "owner",
			invitationExpiresIn: 7 * 24 * 60 * 60, // 7 days
			sendInvitationEmail: async (data) => {
				if (!isEmailEnabled()) {
					log.warn("Email is disabled; skipping invite email");
					return;
				}
				await sendInvitationEmail(data);
			},
		}),
	],

	// Session configuration
	session: {
		expiresIn: 60 * 60 * 24 * 7, // 7 days
		updateAge: 60 * 60 * 24, // Update session every 24 hours
	},

	// Database hooks
	databaseHooks: {
		user: {
			create: {
				before: async (user) => {
					if (allowedSignupEmails && !allowedSignupEmails.includes(user.email.toLowerCase())) {
						throw new Error(
							"Signups are currently invite-only. Join the waitlist at proliferate.com/waitlist",
						);
					}
					return { data: user };
				},
				after: async (user) => {
					// Auto-create a personal organization for new users
					const slug = user.name
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, "-")
						.replace(/^-|-$/g, "");

					try {
						await pool.query(
							`INSERT INTO "organization" (id, name, slug, "createdAt", is_personal)
							 VALUES ($1, $2, $3, NOW(), true)
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

export type Auth = typeof auth;
