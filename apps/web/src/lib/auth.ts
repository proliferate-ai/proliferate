import { logger } from "@/lib/logger";
import { env } from "@proliferate/environment/server";
import { betterAuth } from "better-auth";

const log = logger.child({ module: "auth" });
import { apiKey, organization } from "better-auth/plugins";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { Pool } from "pg";
import { Resend } from "resend";

const isBuild = process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD;
const fallbackAppUrl = isBuild ? "http://localhost:3000" : undefined;
const fallbackAuthSecret = isBuild ? "vercel-build-secret" : undefined;

const appUrl = env.NEXT_PUBLIC_APP_URL ?? fallbackAppUrl;
const authSecret = env.BETTER_AUTH_SECRET ?? fallbackAuthSecret;

const isTrue = (value: unknown) => value === true || value === "true";
const emailEnabled =
	isTrue(env.EMAIL_ENABLED) || isTrue(env.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION);
const resend = emailEnabled ? new Resend(env.RESEND_API_KEY) : null;
const emailFrom = env.EMAIL_FROM ?? "";

if (emailEnabled && !env.RESEND_API_KEY) {
	throw new Error("RESEND_API_KEY is required when email is enabled.");
}

if (emailEnabled && !emailFrom) {
	throw new Error("EMAIL_FROM is required when email is enabled.");
}

const isLocalDb =
	env.DATABASE_URL?.includes("localhost") || env.DATABASE_URL?.includes("127.0.0.1");

const pool = new Pool({
	connectionString: env.DATABASE_URL,
	max: isLocalDb ? 5 : 1, // More connections for local dev; limit in serverless
	idleTimeoutMillis: 10000, // Close idle connections after 10s
	connectionTimeoutMillis: isLocalDb ? 30000 : 5000, // More patience for local dev cold compiles
	// Explicit ssl avoids the pg v8 deprecation warning about sslmode aliases.
	// RDS certs aren't in the default trust store, so rejectUnauthorized: false.
	ssl: isLocalDb ? false : { rejectUnauthorized: false },
});

// When true, blocks login until email is verified and sends verification emails.
// Coerce because SKIP_ENV_VALIDATION returns raw env strings.
const sendVerificationEmails = String(env.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION) === "true";

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
						if (!resend) {
							throw new Error("Email is disabled but verification is required.");
						}

						await resend.emails.send({
							from: emailFrom,
							to: user.email,
							subject: "Verify your email address",
							html: `
				<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
					<h2>Verify your email</h2>
					<p>Hi ${user.name},</p>
					<p>Please verify your email address to complete your registration.</p>
					<p style="margin: 24px 0;">
						<a href="${url}" style="background: #000; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none;">
							Verify Email
						</a>
					</p>
					<p style="color: #666; font-size: 14px;">
						If the button doesn't work, copy and paste this link into your browser.
					</p>
				</div>
			`,
						});
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
				if (!resend) {
					log.warn("Email is disabled; skipping invite email");
					return;
				}
				const inviteUrl = `${env.NEXT_PUBLIC_APP_URL}/invite/${data.id}`;

				await resend.emails.send({
					from: emailFrom,
					to: data.email,
					subject: `You've been invited to join ${data.organization.name}`,
					html: `
					<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
						<h2>You're invited!</h2>
						<p>${data.inviter.user.name} has invited you to join <strong>${data.organization.name}</strong> on Proliferate.</p>
						<p>You'll be joining as a <strong>${data.role}</strong>.</p>
						<p style="margin: 24px 0;">
							<a href="${inviteUrl}" style="background: #000; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none;">
								Accept Invitation
							</a>
						</p>
						<p style="color: #666; font-size: 14px;">
							This invitation expires in 7 days.
						</p>
					</div>
				`,
				});
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
