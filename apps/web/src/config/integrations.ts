import type { CatalogEntry } from "@/components/integrations/integration-picker-dialog";
import type { Provider } from "@/components/integrations/provider-icon";
import { CONNECTOR_PRESETS } from "@proliferate/shared";

const quickPresets = CONNECTOR_PRESETS.filter((p) => p.quickSetup);
const advancedPresets = CONNECTOR_PRESETS.filter((p) => !p.quickSetup && p.key !== "custom");

export const INTEGRATION_CATALOG: CatalogEntry[] = [
	// Source Control
	{
		key: "github",
		name: "GitHub",
		description: "Connect your repositories so agents can manage code and open pull requests",
		category: "source-control",
		type: "oauth",
		provider: "github",
	},

	// Monitoring
	{
		key: "sentry",
		name: "Sentry",
		description: "Monitor errors and track performance issues across your applications",
		category: "monitoring",
		type: "oauth",
		provider: "sentry",
	},

	// Project Management
	{
		key: "linear",
		name: "Linear",
		description: "Track issues and manage projects with your development team",
		category: "project-management",
		type: "oauth",
		provider: "linear",
	},
	{
		key: "jira",
		name: "Jira",
		description: "Create, track, and manage issues across your Jira Cloud projects",
		category: "project-management",
		type: "oauth",
		provider: "jira",
	},

	// Communication
	{
		key: "slack",
		name: "Slack",
		description: "Get notifications and interact with your agents from Slack",
		category: "communication",
		type: "slack",
		provider: "slack",
	},

	// MCP presets (categorized by preset.category, defaults to "developer-tools")
	...quickPresets.map(
		(preset): CatalogEntry => ({
			key: `mcp-${preset.key}`,
			name: preset.name,
			description: preset.description,
			category: preset.category ?? "developer-tools",
			type: "mcp-preset",
			presetKey: preset.key,
		}),
	),
	...advancedPresets.map(
		(preset): CatalogEntry => ({
			key: `mcp-${preset.key}`,
			name: preset.name,
			description: preset.description,
			category: preset.category ?? "developer-tools",
			type: "mcp-preset",
			presetKey: preset.key,
		}),
	),

	// Custom MCP Server
	{
		key: "custom-mcp",
		name: "Custom MCP Server",
		description: "Connect any MCP-compatible tool server with your own URL and credentials",
		category: "developer-tools",
		type: "custom-mcp",
	},
];

/** Core product integrations — always shown as cards at the top of the page */
export const CORE_ENTRIES = INTEGRATION_CATALOG.filter((e) =>
	["github", "slack", "linear", "sentry"].includes(e.key),
);

/** Short descriptions of platform features each core integration powers (beyond tools) */
export const CORE_PLATFORM_NOTES: Record<string, string> = {
	github: "Repos, pull requests, triggers, and agent tools",
	slack: "Notifications, agent interaction, and agent tools",
	linear: "Issue tracking, triggers, automations, and agent tools",
	sentry: "Error monitoring, triggers, automations, and agent tools",
};

export const OAUTH_PROVIDERS: Provider[] = ["github", "sentry", "linear", "jira"];

export type IntegrationTab = "connection" | "permissions";
