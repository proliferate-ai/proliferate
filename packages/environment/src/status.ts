export type DeploymentProfile = "cloud" | "self_host";
export type RequirementScope = "core" | "feature" | "cloud";

export interface EnvRequirement {
	key: string;
	scope: RequirementScope;
	reason: string;
	secret?: boolean;
}

export interface EnvStatus {
	profile: DeploymentProfile;
	features: {
		billingEnabled: boolean;
		emailEnabled: boolean;
		integrationsEnabled: boolean;
		llmProxyEnabled: boolean;
	};
	missing: EnvRequirement[];
}

const isSet = (value: string | undefined) => value !== undefined && value !== "";

export function getEnvStatus(env: NodeJS.ProcessEnv = process.env): EnvStatus {
	const profile: DeploymentProfile = env.DEPLOYMENT_PROFILE === "cloud" ? "cloud" : "self_host";
	const billingEnabled =
		env.NEXT_PUBLIC_BILLING_ENABLED === "true" ||
		env.NEXT_PUBLIC_BILLING_ENABLED === "1" ||
		profile === "cloud";
	const emailEnabled =
		env.EMAIL_ENABLED === "true" ||
		env.EMAIL_ENABLED === "1" ||
		env.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION === "true" ||
		env.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION === "1" ||
		profile === "cloud";
	const integrationsEnabled =
		env.NEXT_PUBLIC_INTEGRATIONS_ENABLED === "true" ||
		env.NEXT_PUBLIC_INTEGRATIONS_ENABLED === "1" ||
		profile === "cloud";
	const llmProxyEnabled =
		env.LLM_PROXY_REQUIRED === "true" ||
		env.LLM_PROXY_REQUIRED === "1" ||
		Boolean(env.LLM_PROXY_URL);

	const missing: EnvRequirement[] = [];

	const requireKey = (key: string, reason: string, scope: RequirementScope, secret = false) => {
		if (!isSet(env[key])) {
			missing.push({ key, reason, scope, secret });
		}
	};

	// Core runtime requirements (always)
	requireKey("DATABASE_URL", "PostgreSQL connection string", "core", true);
	requireKey("REDIS_URL", "Redis connection string", "core", true);
	requireKey("SERVICE_TO_SERVICE_AUTH_TOKEN", "Service-to-service auth token", "core", true);
	requireKey("GATEWAY_JWT_SECRET", "Signs user WebSocket auth JWTs for the gateway", "core", true);
	requireKey("USER_SECRETS_ENCRYPTION_KEY", "Encrypts user secrets at rest", "core", true);
	requireKey("BETTER_AUTH_SECRET", "Auth session signing secret", "core", true);
	requireKey("DEFAULT_SANDBOX_PROVIDER", "Selects sandbox provider (e2b|modal)", "core");
	requireKey("ANTHROPIC_API_KEY", "Claude API key (direct or for LLM proxy)", "core", true);

	if (profile === "self_host") {
		requireKey("NEXT_PUBLIC_APP_URL", "Public app URL (build/runtime)", "core");
		requireKey("NEXT_PUBLIC_API_URL", "Public API URL (build/runtime)", "core");
		requireKey("NEXT_PUBLIC_GATEWAY_URL", "Public gateway URL (build/runtime)", "core");
	}

	// Sandbox provider requirements
	if (env.DEFAULT_SANDBOX_PROVIDER === "e2b") {
		requireKey("E2B_API_KEY", "E2B API key", "feature", true);
		requireKey("E2B_DOMAIN", "E2B API domain", "feature");
		requireKey("E2B_TEMPLATE", "E2B template name", "feature");
		requireKey("E2B_TEMPLATE_ALIAS", "E2B template alias", "feature");
	} else if (env.DEFAULT_SANDBOX_PROVIDER === "modal") {
		requireKey("MODAL_APP_NAME", "Modal app name", "feature");
		requireKey("MODAL_TOKEN_ID", "Modal token ID", "feature", true);
		requireKey("MODAL_TOKEN_SECRET", "Modal token secret", "feature", true);
	}

	// LLM proxy requirements (if enabled)
	if (llmProxyEnabled) {
		requireKey("LLM_PROXY_URL", "LLM proxy URL", "feature");
		requireKey("LLM_PROXY_MASTER_KEY", "LLM proxy master key", "feature", true);
	}

	// Integrations (Nango) requirements
	if (integrationsEnabled) {
		requireKey("NANGO_SECRET_KEY", "Nango secret key", "feature", true);
		requireKey("NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID", "Nango GitHub integration ID", "feature");
		requireKey("NEXT_PUBLIC_NANGO_LINEAR_INTEGRATION_ID", "Nango Linear integration ID", "feature");
		requireKey("NEXT_PUBLIC_NANGO_SENTRY_INTEGRATION_ID", "Nango Sentry integration ID", "feature");
	}

	const useNangoGitHub =
		env.NEXT_PUBLIC_USE_NANGO_GITHUB === "true" || env.NEXT_PUBLIC_USE_NANGO_GITHUB === "1";
	// GitHub App requirements (when not using Nango for GitHub)
	if (!useNangoGitHub) {
		requireKey("GITHUB_APP_ID", "GitHub App ID (repo access)", "feature");
		requireKey("GITHUB_APP_PRIVATE_KEY", "GitHub App private key", "feature", true);
		requireKey("GITHUB_APP_WEBHOOK_SECRET", "GitHub App webhook secret", "feature", true);
		requireKey("NEXT_PUBLIC_GITHUB_APP_SLUG", "GitHub App slug (install URL)", "feature");
	}

	// Billing requirements (cloud or explicitly enabled)
	if (billingEnabled) {
		requireKey("AUTUMN_API_KEY", "Autumn API key", "cloud", true);
		requireKey("AUTUMN_API_URL", "Autumn API URL", "cloud");
		requireKey("BILLING_JWT_SECRET", "Billing JWT secret", "cloud", true);
	}

	// Email requirements (cloud or explicitly enabled)
	if (emailEnabled) {
		requireKey("RESEND_API_KEY", "Resend API key", "feature", true);
		requireKey("EMAIL_FROM", "From address for outbound email", "feature");
	}

	// Verification storage (cloud profile)
	if (profile === "cloud") {
		requireKey("S3_BUCKET", "S3 bucket for verification media", "cloud");
		requireKey("S3_REGION", "S3 region for verification media", "cloud");
	}

	return {
		profile,
		features: {
			billingEnabled,
			emailEnabled,
			integrationsEnabled,
			llmProxyEnabled,
		},
		missing,
	};
}
