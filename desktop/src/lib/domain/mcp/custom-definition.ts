import type { ConnectorCatalogEntry } from "./types";
import type { CustomMcpDefinition } from "@/lib/integrations/cloud/client";

export function customDefinitionToCatalogEntry(
  definition: CustomMcpDefinition,
): ConnectorCatalogEntry {
  const common = {
    id: `custom:${definition.definitionId}`,
    name: definition.name,
    oneLiner: definition.description || `Custom MCP server: ${definition.name}`,
    description: definition.description,
    docsUrl: "",
    availability: definition.availability,
    cloudSecretSync: false,
    setupKind: "none" as const,
    serverNameBase: definition.serverNameBase,
    iconId: definition.iconId,
    displayUrl: definition.displayUrl,
    oauthClientMode: undefined,
    secretFields: definition.secretFields.map((field) => ({
      id: field.id,
      label: field.label,
      placeholder: field.placeholder,
      helperText: field.helperText,
      getTokenInstructions: field.getTokenInstructions,
      prefixHint: field.prefixHint ?? undefined,
    })),
    requiredFields: definition.secretFields.map((field) => ({
      id: field.id,
      label: field.label,
      placeholder: field.placeholder,
      helperText: field.helperText,
      getTokenInstructions: field.getTokenInstructions,
      prefixHint: field.prefixHint ?? undefined,
    })),
    settingsSchema: [],
    capabilities: ["Custom MCP server"],
  };
  if (definition.transport === "stdio") {
    return {
      ...common,
      transport: "stdio",
      authKind: definition.authKind,
      command: definition.displayUrl || definition.name,
      args: [],
      env: [],
    };
  }
  return {
    ...common,
    transport: "http",
    authKind: definition.authKind,
    url: definition.displayUrl,
    authStyle: definition.authKind === "secret" ? { kind: "bearer" as const } : undefined,
    authFieldId: definition.secretFields[0]?.id,
  };
}
