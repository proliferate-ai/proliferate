import { z } from "zod";

const requiredString = z.string().min(1);
// Treat empty strings as undefined for optional env vars
const optionalString = z
	.string()
	.optional()
	.transform((val) => (val === "" ? undefined : val));
const optionalBoolean = z
	.enum(["true", "false", "1", "0"])
	.default("false")
	.transform((value) => value === "true" || value === "1");
const optionalPort = (defaultPort: number) =>
	z.coerce.number().int().positive().default(defaultPort);
const optionalSeconds = (defaultSeconds: number) =>
	z.coerce.number().int().positive().default(defaultSeconds);

const isTruthy = (value: string | undefined) => value === "true" || value === "1";

type EnvLike = Record<string, string | undefined>;

const optionalLogLevel = optionalString
	.transform((value) => value?.toLowerCase())
	.refine(
		(value) =>
			value === undefined ||
			value === "trace" ||
			value === "debug" ||
			value === "info" ||
			value === "warn" ||
			value === "error" ||
			value === "fatal" ||
			value === "silent",
		{ message: "Must be one of: trace, debug, info, warn, error, fatal, silent" },
	);

const requiredWhen = (enabled: boolean, message: string) =>
	optionalString.refine((val) => !enabled || (val && val.length > 0), { message });

// Provider-specific: only required when DEFAULT_SANDBOX_PROVIDER matches
const requiredForProvider = (env: EnvLike, provider: "e2b" | "modal") =>
	z
		.string()
		.optional()
		.refine((val) => env.DEFAULT_SANDBOX_PROVIDER !== provider || (val && val.length > 0), {
			message: `Required when DEFAULT_SANDBOX_PROVIDER is '${provider}'`,
		});

// GitHub App vars: only required when NOT using Nango for GitHub auth
const requiredForGitHubApp = (env: EnvLike) =>
	z
		.string()
		.optional()
		.refine((val) => isTruthy(env.NEXT_PUBLIC_USE_NANGO_GITHUB) || (val && val.length > 0), {
			message: "Required when NEXT_PUBLIC_USE_NANGO_GITHUB is not 'true'",
		});

export const createPublicSchema = (env: EnvLike = process.env) => {
	const isCloudProfile = env.DEPLOYMENT_PROFILE === "cloud";
	const integrationsEnabled = isTruthy(env.NEXT_PUBLIC_INTEGRATIONS_ENABLED) || isCloudProfile;

	return {
		NEXT_PUBLIC_APP_URL: requiredString,
		NEXT_PUBLIC_GATEWAY_URL: requiredString,
		NEXT_PUBLIC_API_URL: requiredString,
		NEXT_PUBLIC_BILLING_ENABLED: optionalBoolean,
		NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION: optionalBoolean,
		NEXT_PUBLIC_INTEGRATIONS_ENABLED: optionalBoolean,
		NEXT_PUBLIC_SENTRY_DSN: optionalString,
		NEXT_PUBLIC_GITHUB_APP_SLUG: requiredForGitHubApp(env), // Required when using GitHub App (default)
		NEXT_PUBLIC_INTERCOM_APP_ID: optionalString,
		NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID: requiredWhen(
			integrationsEnabled,
			"Required when integrations are enabled",
		),
		NEXT_PUBLIC_NANGO_LINEAR_INTEGRATION_ID: requiredWhen(
			integrationsEnabled,
			"Required when integrations are enabled",
		),
		NEXT_PUBLIC_NANGO_SENTRY_INTEGRATION_ID: requiredWhen(
			integrationsEnabled,
			"Required when integrations are enabled",
		),
		NEXT_PUBLIC_POSTHOG_HOST: optionalString,
		NEXT_PUBLIC_POSTHOG_KEY: optionalString,
		NEXT_PUBLIC_USE_NANGO_GITHUB: optionalBoolean,
	} as const;
};

export const createServerSchema = (env: EnvLike = process.env) => {
	const isCloudProfile = env.DEPLOYMENT_PROFILE === "cloud";
	const billingEnabled = isTruthy(env.NEXT_PUBLIC_BILLING_ENABLED) || isCloudProfile;
	const integrationsEnabled = isTruthy(env.NEXT_PUBLIC_INTEGRATIONS_ENABLED) || isCloudProfile;
	const emailEnabled =
		isTruthy(env.EMAIL_ENABLED) ||
		isTruthy(env.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION) ||
		isCloudProfile;
	const verificationStorageRequired = isCloudProfile;

	return {
		DEPLOYMENT_PROFILE: z.enum(["cloud", "self_host"]).default("self_host"),
		DATABASE_URL: requiredString,
		BETTER_AUTH_SECRET: requiredString,
		ANTHROPIC_API_KEY: requiredString,
		API_PORT: optionalPort(3001),
		AUTH_TOKEN: optionalString, // Only used in test scripts
		AUTUMN_API_KEY: requiredWhen(
			billingEnabled,
			"Required when billing is enabled (NEXT_PUBLIC_BILLING_ENABLED=true or cloud profile)",
		),
		AUTUMN_API_URL: requiredWhen(
			billingEnabled,
			"Required when billing is enabled (NEXT_PUBLIC_BILLING_ENABLED=true or cloud profile)",
		),
		BILLING_JWT_SECRET: requiredWhen(
			billingEnabled,
			"Required when billing is enabled (NEXT_PUBLIC_BILLING_ENABLED=true or cloud profile)",
		),
		CI: optionalBoolean,
		COMPOSIO_API_KEY: optionalString,
		COMPOSIO_BASE_URL: optionalString,
		DEFAULT_SANDBOX_PROVIDER: z.enum(["e2b", "modal"]),
		DEV_USER_ID: optionalString, // Local dev convenience
		E2B_API_KEY: requiredForProvider(env, "e2b"),
		E2B_DOMAIN: requiredForProvider(env, "e2b"),
		E2B_TEMPLATE: requiredForProvider(env, "e2b"),
		E2B_TEMPLATE_ALIAS: requiredForProvider(env, "e2b"),
		EMAIL_FROM: requiredWhen(
			emailEnabled,
			"Required when email is enabled (EMAIL_ENABLED=true, NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION=true, or cloud profile)",
		),
		GATEWAY_PORT: optionalPort(8787),
		GATEWAY_JWT_SECRET: requiredString, // Signs user WebSocket auth JWTs for the gateway
		GITHUB_APP_ID: requiredForGitHubApp(env),
		GITHUB_APP_PRIVATE_KEY: requiredForGitHubApp(env),
		GITHUB_APP_WEBHOOK_SECRET: requiredForGitHubApp(env),
		GITHUB_OAUTH_APP_ID: optionalString, // OAuth app for user login (optional if using other auth)
		GITHUB_OAUTH_APP_SECRET: optionalString,
		GOOGLE_CLIENT_ID: optionalString, // Optional - only needed if enabling Google OAuth
		GOOGLE_CLIENT_SECRET: optionalString,
		INTERCOM_SECRET_KEY: optionalString, // Only needed if using Intercom identity verification
		LLM_PROXY_MASTER_KEY: optionalString, // Only needed if using LLM proxy
		LLM_PROXY_URL: optionalString, // Only needed if using LLM proxy
		LLM_PROXY_KEY_DURATION: optionalString, // Only needed if using LLM proxy
		LLM_PROXY_REQUIRED: optionalBoolean,
		LLM_PROXY_ADMIN_URL: optionalString,
		LLM_PROXY_PUBLIC_URL: optionalString,
		LOG_LEVEL: optionalLogLevel,
		LOG_PRETTY: optionalBoolean,
		MODAL_APP_NAME: requiredForProvider(env, "modal"),
		MODAL_APP_SUFFIX: optionalString, // Optional per-dev suffix (e.g., "pablo" → "proliferate-sandbox-pablo")
		MODAL_BASE_SNAPSHOT_ID: optionalString, // Optional base snapshot (pre-baked filesystem) for near-zero session startup
		MODAL_ENDPOINT_URL: optionalString, // Only used in test scripts, not production
		MODAL_TOKEN_ID: requiredForProvider(env, "modal"),
		MODAL_TOKEN_SECRET: requiredForProvider(env, "modal"),
		NANGO_SECRET_KEY: requiredWhen(integrationsEnabled, "Required when integrations are enabled"),
		NEXT_BUILD_STANDALONE: optionalBoolean,
		OPENAI_API_KEY: optionalString, // Used by LLM proxy for OpenAI model routing
		GOOGLE_API_KEY: optionalString, // Used by LLM proxy for Gemini model routing
		DEEPSEEK_API_KEY: optionalString, // Used by LLM proxy for DeepSeek model routing
		XAI_API_KEY: optionalString, // Used by LLM proxy for xAI Grok model routing
		MISTRAL_API_KEY: optionalString, // Used by LLM proxy for Mistral model routing
		WEB_PORT: optionalPort(3000),
		WORKER_PORT: optionalPort(3002),
		PROLIFERATE_SLACK_BOT_TOKEN: optionalString, // Only needed if using Slack integration
		PROLIFERATE_SLACK_CONNECT_EMAILS: optionalString,
		REDIS_URL: requiredString,
		EMAIL_ENABLED: optionalBoolean,
		RESEND_API_KEY: requiredWhen(
			emailEnabled,
			"Required when email is enabled (EMAIL_ENABLED=true, NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION=true, or cloud profile)",
		),
		TRIGGER_SERVICE_URL: optionalString, // Only needed if using trigger service
		S3_ACCESS_KEY: optionalString,
		S3_BUCKET: requiredWhen(
			verificationStorageRequired,
			"Required for verification media storage in cloud profile",
		),
		S3_ENDPOINT_URL: optionalString,
		S3_REGION: requiredWhen(
			verificationStorageRequired,
			"Required for verification media storage in cloud profile",
		),
		S3_SECRET_KEY: optionalString,
		SANDBOX_GIT_PULL_ON_RESTORE: optionalBoolean, // Opt-in: run git pull --ff-only on restored snapshots
		SANDBOX_GIT_PULL_CADENCE_SECONDS: z.coerce
			.number()
			.int()
			.min(0)
			.default(0)
			.describe(
				"Minimum seconds between git pulls on snapshot restore. 0 = always pull when enabled.",
			),
		SANDBOX_IMAGE_VERSION: optionalString, // Optional cache-buster input for base snapshot version-key
		IDLE_SNAPSHOT_DELAY_SECONDS: optionalSeconds(300),
		SANDBOX_TIMEOUT_SECONDS: optionalSeconds(3600),
		SNAPSHOT_RETENTION_DAYS: z.coerce
			.number()
			.int()
			.min(1)
			.default(14)
			.describe(
				"Maximum age in days for session snapshots. Snapshots older than this are evicted on the next pause/snapshot.",
			),
		SENTRY_AUTH_TOKEN: optionalString,
		SENTRY_ORG: optionalString,
		SENTRY_PROJECT: optionalString,
		SERVICE_TO_SERVICE_AUTH_TOKEN: requiredString,
		SLACK_CLIENT_ID: optionalString, // Only needed if using Slack integration
		SLACK_CLIENT_SECRET: optionalString,
		SLACK_SIGNING_SECRET: optionalString,
		STRICT_ENV: optionalBoolean,
		SUPER_ADMIN_EMAILS: z.string().default(""),
		TEST_REPO_ID: optionalString, // Only used in test scripts
		TEST_TOKEN: optionalString, // Only used in test scripts
		USER_SECRETS_ENCRYPTION_KEY: requiredString,
		WORKSPACE_DIR: optionalString, // Local dev convenience
	} as const;
};

export type PublicSchema = ReturnType<typeof createPublicSchema>;
export type ServerSchema = ReturnType<typeof createServerSchema>;
