import type { IntegrationCategory } from "@proliferate/shared";

import type { IntegrationScopeMeta } from "@/config/integration-scopes";

interface IntegrationScopeInput {
	key: string;
	type: "oauth" | "slack" | "mcp-preset" | "custom-mcp";
	category: IntegrationCategory;
}

const ORG_SCOPED_ONLY_KEYS = new Set(["slack"]);

export function getIntegrationScopeMeta(input: IntegrationScopeInput): IntegrationScopeMeta {
	if (ORG_SCOPED_ONLY_KEYS.has(input.key)) {
		return {
			label: "Org scope",
			description: "Only admins can set this up for the organization.",
		};
	}

	if (input.type === "mcp-preset" || input.type === "custom-mcp") {
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
