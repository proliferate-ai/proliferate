import { createEnv } from "@t3-oss/env-core";
import { createPublicSchema } from "./schema";

const runtimeEnv = {
	NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
	NEXT_PUBLIC_GATEWAY_URL: process.env.NEXT_PUBLIC_GATEWAY_URL,
	NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
	NEXT_PUBLIC_BILLING_ENABLED: process.env.NEXT_PUBLIC_BILLING_ENABLED,
	NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION: process.env.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION,
	NEXT_PUBLIC_INTEGRATIONS_ENABLED: process.env.NEXT_PUBLIC_INTEGRATIONS_ENABLED,
	NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
	NEXT_PUBLIC_GITHUB_APP_SLUG: process.env.NEXT_PUBLIC_GITHUB_APP_SLUG,
	NEXT_PUBLIC_INTERCOM_APP_ID: process.env.NEXT_PUBLIC_INTERCOM_APP_ID,
	NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID: process.env.NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID,
	NEXT_PUBLIC_NANGO_LINEAR_INTEGRATION_ID: process.env.NEXT_PUBLIC_NANGO_LINEAR_INTEGRATION_ID,
	NEXT_PUBLIC_NANGO_SENTRY_INTEGRATION_ID: process.env.NEXT_PUBLIC_NANGO_SENTRY_INTEGRATION_ID,
	NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
	NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
	NEXT_PUBLIC_USE_NANGO_GITHUB: process.env.NEXT_PUBLIC_USE_NANGO_GITHUB,
};

const rawEnv = createEnv({
	server: {},
	client: createPublicSchema(runtimeEnv),
	runtimeEnv,
	clientPrefix: "NEXT_PUBLIC_",
	skipValidation:
		process.env.SKIP_ENV_VALIDATION === "true" ||
		(process.env.NODE_ENV !== "production" && process.env.STRICT_ENV !== "true"),
	onValidationError: (issues) => {
		const details = issues
			.map((issue) => `  ${issue.path?.join(".") || "unknown"}: ${issue.message}`)
			.join("\n");
		const message = `Invalid environment variables:\n${details}`;
		console.error(message);
		throw new Error(message);
	},
});

const normalizeBoolean = (value: unknown, fallback = false) => {
	if (value === true || value === "true" || value === "1") return true;
	if (value === false || value === "false" || value === "0") return false;
	return fallback;
};

export const env = {
	...rawEnv,
	NEXT_PUBLIC_BILLING_ENABLED: normalizeBoolean(rawEnv.NEXT_PUBLIC_BILLING_ENABLED),
	NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION: normalizeBoolean(
		rawEnv.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION,
	),
	NEXT_PUBLIC_INTEGRATIONS_ENABLED: normalizeBoolean(rawEnv.NEXT_PUBLIC_INTEGRATIONS_ENABLED),
	NEXT_PUBLIC_USE_NANGO_GITHUB: normalizeBoolean(rawEnv.NEXT_PUBLIC_USE_NANGO_GITHUB),
} as typeof rawEnv;
