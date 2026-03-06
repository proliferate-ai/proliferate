import type { IntegrationCategory } from "@proliferate/shared";

interface IntegrationScopeInput {
	key: string;
	type: "oauth" | "slack" | "mcp-preset" | "custom-mcp";
	category: IntegrationCategory;
}

export interface IntegrationScopeMeta {
	label: "Org scope" | "User or org scope";
	description: string;
}

const ORG_SCOPED_ONLY_KEYS = new Set(["slack", "custom-mcp"]);

export function getIntegrationScopeMeta(input: IntegrationScopeInput): IntegrationScopeMeta {
	if (ORG_SCOPED_ONLY_KEYS.has(input.key)) {
		return {
			label: "Org scope",
			description: "Only admins can set this up for the organization.",
		};
	}

	if (input.type === "mcp-preset") {
		return {
			label: "Org scope",
			description: "Only admins can set this up for the organization.",
		};
	}

	return {
		label: "User or org scope",
		description: "Admins can configure org defaults; users can configure personal action defaults.",
	};
}
