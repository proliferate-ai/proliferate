import type { CatalogEntry } from "@/components/integrations/integration-picker-dialog";
import { resolveActiveComposioConnector } from "@/lib/integrations/composio-connectors";
import type { ConnectorConfig } from "@proliferate/shared";
import { describe, expect, it } from "vitest";

const notionEntry: CatalogEntry = {
	key: "notion",
	name: "Notion",
	description: "Manage pages and databases in Notion",
	category: "productivity",
	type: "composio-oauth",
	presetKey: "notion",
};

function makeConnector(
	input: Partial<ConnectorConfig> & Pick<ConnectorConfig, "id" | "name">,
): ConnectorConfig {
	return {
		id: input.id,
		name: input.name,
		transport: "remote_http",
		url: input.url ?? "https://example.com/mcp",
		auth: input.auth ?? {
			type: "custom_header",
			secretKey: "COMPOSIO_API_KEY",
			headerName: "x-api-key",
		},
		enabled: input.enabled ?? true,
		riskPolicy: input.riskPolicy,
		composioToolkit: input.composioToolkit,
		composioAccountId: input.composioAccountId,
	};
}

describe("resolveActiveComposioConnector", () => {
	it("ignores disabled and account-less rows when resolving a Composio connector", () => {
		const connector = resolveActiveComposioConnector(notionEntry, [
			makeConnector({
				id: "disabled-row",
				name: "Notion (old)",
				enabled: false,
				composioToolkit: "notion",
				composioAccountId: "ca_disabled",
			}),
			makeConnector({
				id: "missing-account",
				name: "Notion (broken)",
				composioToolkit: "notion",
			}),
			makeConnector({
				id: "active-row",
				name: "Notion",
				composioToolkit: "notion",
				composioAccountId: "ca_active",
			}),
		]);

		expect(connector?.id).toBe("active-row");
	});
});
