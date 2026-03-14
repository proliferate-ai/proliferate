/**
 * Server-side configuration.
 *
 * Centralized source of truth for server-only env reads.
 * Only imported from server-side modules (lib/auth/*, lib/infra/email.ts).
 */
import "server-only";

export const serverConfig = {
	databaseUrl: process.env.DATABASE_URL ?? "",
	betterAuthSecret: process.env.BETTER_AUTH_SECRET ?? "",
	appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",

	// Auth
	devUserId: process.env.DEV_USER_ID,
	ci: process.env.CI,
	superAdminEmails: process.env.SUPER_ADMIN_EMAILS ?? "",

	// Email
	resendApiKey: process.env.RESEND_API_KEY,
	emailFrom: process.env.EMAIL_FROM ?? "",
};

export function isDevMode(): boolean {
	return process.env.NODE_ENV !== "production";
}

export function isLocalDb(): boolean {
	const url = serverConfig.databaseUrl;
	return !url.includes("amazonaws.com") && !url.includes("neon.tech");
}
