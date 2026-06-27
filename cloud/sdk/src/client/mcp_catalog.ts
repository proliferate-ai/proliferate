import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import { listIntegrationDefinitions, type IntegrationDefinition } from "./integrations.js";
import type { CloudMcpCatalogResponse } from "../types/index.js";

export async function getCloudMcpCatalog(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudMcpCatalogResponse> {
  const definitions = await listIntegrationDefinitions({}, client);
  return {
    catalogVersion: "integrations-v1",
    entries: definitions.map((definition) =>
      definitionToCatalogEntry(
        definition,
        client.buildUrl("/v1/cloud/integration-gateway/mcp"),
      )),
    pluginPackages: [],
  };
}

function definitionToCatalogEntry(
  definition: IntegrationDefinition,
  gatewayUrl: string,
): CloudMcpCatalogResponse["entries"][number] {
  const authKind = definition.authModes.some((mode) => mode.kind === "oauth2")
    ? "oauth"
    : definition.authModes.some((mode) => mode.kind === "api_key")
      ? "secret"
      : "none";
  const oauthMode = definition.authModes.find((mode) => mode.kind === "oauth2")?.clientStrategy;
  return {
    id: definition.id,
    version: 1,
    name: definition.displayName,
    oneLiner: `${definition.displayName} MCP tools`,
    description: `Connect ${definition.displayName} to Proliferate agents through the integration gateway.`,
    docsUrl: "",
    availability: "cloud_only",
    cloudSecretSync: false,
    setupKind: "none",
    transport: "http",
    authKind,
    oauthClientMode: oauthMode === "static" ? "static" : oauthMode ? "dcr" : null,
    authStyle: null,
    authFieldId: authKind === "secret" ? "token" : null,
    url: gatewayUrl,
    displayUrl: definition.providerGroup ?? definition.namespace,
    command: null,
    args: [],
    env: [],
    serverNameBase: definition.namespace,
    iconId: definition.iconId ?? definition.namespace,
    secretFields: authKind === "secret"
      ? [{
          id: "token",
          label: "API key",
          placeholder: "Paste API key",
          helperText: "Stored by Proliferate and used only by the integration gateway.",
          getTokenInstructions: "",
          prefixHint: null,
        }]
      : [],
    requiredFields: [],
    settingsSchema: definition.settings.map((setting) => ({
      id: setting.id,
      kind: "select",
      label: setting.label,
      placeholder: "",
      helperText: "",
      required: true,
      defaultValue: setting.default,
      options: setting.options,
      affectsUrl: true,
    })),
    capabilities: ["Tools"],
  };
}
