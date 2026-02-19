interface ToolConfig {
	enabled: boolean;
	channelId?: string;
	teamId?: string;
	defaultTo?: string;
}

interface EnabledTools {
	slack_notify?: ToolConfig;
	create_linear_issue?: ToolConfig;
	email_user?: ToolConfig;
	create_session?: ToolConfig;
}

export interface ReadinessIssue {
	message: string;
	href?: string;
}

export interface ReadinessResult {
	ready: boolean;
	issues: ReadinessIssue[];
}

/** Trigger providers that require an integration connection */
const INTEGRATION_TRIGGER_PROVIDERS = new Set(["github", "linear", "sentry"]);

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
	github: "GitHub",
	linear: "Linear",
	sentry: "Sentry",
	slack: "Slack",
};

export function computeReadiness(params: {
	enabledTools: EnabledTools;
	connectedProviders: Set<string>;
	agentInstructions: string | null;
	triggerProviders?: string[];
}): ReadinessResult {
	const issues: ReadinessIssue[] = [];

	// Triggers requiring disconnected integrations
	if (params.triggerProviders) {
		const seen = new Set<string>();
		for (const provider of params.triggerProviders) {
			if (
				INTEGRATION_TRIGGER_PROVIDERS.has(provider) &&
				!params.connectedProviders.has(provider) &&
				!seen.has(provider)
			) {
				seen.add(provider);
				const name = PROVIDER_DISPLAY_NAMES[provider] ?? provider;
				issues.push({
					message: `${name} not connected — required by trigger`,
					href: "/dashboard/integrations",
				});
			}
		}
	}

	// Slack enabled but not connected
	if (params.enabledTools.slack_notify?.enabled && !params.connectedProviders.has("slack")) {
		issues.push({ message: "Slack not connected", href: "/dashboard/integrations" });
	}

	// Linear enabled but not connected
	if (
		params.enabledTools.create_linear_issue?.enabled &&
		!params.connectedProviders.has("linear")
	) {
		issues.push({ message: "Linear not connected", href: "/dashboard/integrations" });
	}

	// Empty/missing instructions
	if (!params.agentInstructions?.trim()) {
		issues.push({ message: "No agent instructions" });
	}

	return { ready: issues.length === 0, issues };
}
