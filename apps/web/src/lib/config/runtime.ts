/**
 * Runtime configuration.
 *
 * Centralized source of truth for env reads used by auth, Sentry, and runtime bootstrap.
 */

export const runtimeConfig = {
	enforceEmailVerification: Boolean(process.env.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION),
	nodeEnv: process.env.NODE_ENV,
	sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? "",
};

export function getNextRuntime(): string | undefined {
	return process.env.NEXT_RUNTIME;
}
