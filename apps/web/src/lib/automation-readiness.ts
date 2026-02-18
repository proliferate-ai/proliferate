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

export interface ReadinessResult {
	ready: boolean;
	issues: string[];
}

export function computeReadiness(params: {
	enabledTools: EnabledTools;
	connectedProviders: Set<string>;
	agentInstructions: string | null;
}): ReadinessResult {
	const issues: string[] = [];

	// Slack enabled but not connected
	if (params.enabledTools.slack_notify?.enabled && !params.connectedProviders.has("slack")) {
		issues.push("Slack not connected");
	}

	// Linear enabled but not connected
	if (
		params.enabledTools.create_linear_issue?.enabled &&
		!params.connectedProviders.has("linear")
	) {
		issues.push("Linear not connected");
	}

	// Empty/missing instructions
	if (!params.agentInstructions?.trim()) {
		issues.push("No agent instructions");
	}

	return { ready: issues.length === 0, issues };
}
