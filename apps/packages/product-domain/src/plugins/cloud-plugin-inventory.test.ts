import { describe, expect, it } from "vitest";
import type {
  CloudMcpCatalogEntry,
  CloudMcpCatalogResponse,
  CloudMcpConnection,
  CloudPluginConfiguredItem,
  CloudSkillConfiguredItem,
} from "@proliferate/cloud-sdk";
import {
  buildCloudPluginInventory,
  createDefaultPluginDraft,
  validatePluginSecrets,
  validatePluginSettings,
} from "./cloud-plugin-inventory";

describe("cloud plugin inventory", () => {
  it("combines installed connections with package plugin and skill state", () => {
    const inventory = buildCloudPluginInventory({
      catalog: catalog([githubEntry()], [githubPackage()]),
      connections: [connection({
        catalogEntryId: "github",
        publicToOrg: true,
        publicStatus: "public",
      })],
      configuredPlugins: [configuredPlugin({ publicToOrg: true, publicStatus: "public" })],
      configuredSkills: [configuredSkill({ publicToOrg: true, publicStatus: "public" })],
      surface: "desktop",
    });

    expect(inventory).toHaveLength(1);
    expect(inventory[0]).toMatchObject({
      state: "installed",
      statusLabel: "Connected",
      setupVariant: "oauth",
      capabilitySummary: "MCP · 1 skill · OAuth",
      includesLabel: "App + 1 MCP + 1 skill",
      sharedLabel: "Shared public",
      isFullyPublic: true,
    });
  });

  it("keeps local oauth plugins visible but desktop-gated on web", () => {
    const inventory = buildCloudPluginInventory({
      catalog: catalog([gmailEntry()], []),
      connections: [],
      configuredPlugins: [],
      configuredSkills: [],
      surface: "web",
    });

    expect(inventory[0]).toMatchObject({
      state: "available",
      setupVariant: "local_oauth",
      statusLabel: "Requires Desktop",
      unavailableReason: "Requires Desktop",
    });
  });

  it("marks broken browser auth as reconnectable", () => {
    const inventory = buildCloudPluginInventory({
      catalog: catalog([githubEntry()], []),
      connections: [connection({ authStatus: "needs_reconnect" as CloudMcpConnection["authStatus"] })],
      configuredPlugins: [],
      configuredSkills: [],
      surface: "desktop",
    });

    expect(inventory[0]).toMatchObject({
      broken: true,
      statusLabel: "Needs reconnect",
      statusActionLabel: "Reconnect",
      statusTone: "error",
    });
  });

  it("normalizes draft settings and validates token fields", () => {
    const inventory = buildCloudPluginInventory({
      catalog: catalog([posthogEntry()], []),
      connections: [],
      configuredPlugins: [],
      configuredSkills: [],
      surface: "desktop",
    });
    const item = inventory[0]!;
    const draft = createDefaultPluginDraft(item);

    expect(draft.settings).toEqual({ region: "us" });
    expect(validatePluginSettings(item.entry, { region: "eu" })).toBeNull();
    expect(validatePluginSettings(item.entry, { region: "antarctica" })).toBe(
      "Choose a valid Region.",
    );
    expect(validatePluginSecrets(item.entry, { apiKey: "phx_example" })).toBeNull();
    expect(validatePluginSecrets(item.entry, { apiKey: "bad token" })).toBe(
      "API key: Enter a single-line token.",
    );
  });
});

function catalog(
  entries: CloudMcpCatalogEntry[],
  pluginPackages: NonNullable<CloudMcpCatalogResponse["pluginPackages"]>,
): CloudMcpCatalogResponse {
  return {
    catalogVersion: "test",
    entries,
    pluginPackages,
  };
}

function githubEntry(): CloudMcpCatalogEntry {
  return {
    id: "github",
    version: 1,
    name: "GitHub",
    oneLiner: "Work with issues and pull requests.",
    description: "GitHub tools.",
    docsUrl: "https://docs.example/github",
    availability: "universal",
    cloudSecretSync: true,
    setupKind: "none",
    transport: "http",
    authKind: "oauth",
    url: "https://github.example/mcp",
    displayUrl: "github.example",
    serverNameBase: "github",
    iconId: "github",
    secretFields: [],
    requiredFields: [],
    settingsSchema: [],
    capabilities: ["issues"],
  };
}

function gmailEntry(): CloudMcpCatalogEntry {
  return {
    ...githubEntry(),
    id: "gmail",
    name: "Gmail",
    oneLiner: "Read Gmail.",
    setupKind: "local_oauth",
    authKind: "none",
    url: "https://gmail.example/mcp",
    serverNameBase: "gmail",
  };
}

function posthogEntry(): CloudMcpCatalogEntry {
  return {
    ...githubEntry(),
    id: "posthog",
    name: "PostHog",
    oneLiner: "Inspect product analytics.",
    authKind: "secret",
    url: "https://posthog.example/mcp",
    secretFields: [{
      id: "apiKey",
      label: "API key",
      placeholder: "phx_...",
      helperText: "A PostHog project key.",
      getTokenInstructions: "Open PostHog settings.",
      prefixHint: "phx_",
    }],
    requiredFields: [],
    settingsSchema: [{
      id: "region",
      kind: "select",
      label: "Region",
      placeholder: "",
      helperText: "PostHog cloud region.",
      required: true,
      defaultValue: "us",
      options: [
        { value: "us", label: "US" },
        { value: "eu", label: "EU" },
      ],
      affectsUrl: true,
    }],
  };
}

function githubPackage(): NonNullable<CloudMcpCatalogResponse["pluginPackages"]>[number] {
  return {
    id: "github-package",
    catalogEntryId: "github",
    version: "1.0.0",
    displayName: "GitHub",
    description: "GitHub plugin package.",
    skills: [{
      id: "github-triage",
      displayName: "GitHub triage",
      description: "Triage issues.",
      instructions: "Help triage.",
      requiredMcpServerRefs: ["github"],
      requiresCredentialBinding: true,
      resources: [],
      defaultEnabled: true,
      provenance: {
        sourceRepoUrl: "https://github.example/repo",
        sourcePath: "skills/github.md",
        sourceRef: "a".repeat(40),
        sourceSha256: "b".repeat(64),
        adaptedSha256: "c".repeat(64),
        sourceLicense: "MIT",
        importMode: "adapted",
        reviewStatus: "reviewed",
        reviewer: "test",
        reviewedAt: "2026-01-01T00:00:00Z",
        notes: "",
      },
    }],
  };
}

function connection(overrides: Partial<CloudMcpConnection> = {}): CloudMcpConnection {
  return {
    connectionId: "conn_github",
    ownerScope: "personal",
    ownerUserId: "user_1",
    organizationId: null,
    catalogEntryId: "github",
    catalogEntryVersion: 1,
    serverName: "github",
    enabled: true,
    publicToOrg: false,
    publicOrganizationId: null,
    publicStatus: "private",
    publicUpdatedAt: null,
    publicUpdatedByUserId: null,
    authKind: "oauth",
    authStatus: "ready",
    settings: {},
    configVersion: 1,
    authVersion: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function configuredPlugin(
  overrides: Partial<CloudPluginConfiguredItem> = {},
): CloudPluginConfiguredItem {
  return {
    id: "plugin_item_1",
    ownerScope: "personal",
    ownerUserId: "user_1",
    organizationId: null,
    pluginId: "github-package",
    pluginVersion: "1.0.0",
    enabled: true,
    publicToOrg: false,
    publicOrganizationId: null,
    publicStatus: "private",
    configVersion: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function configuredSkill(
  overrides: Partial<CloudSkillConfiguredItem> = {},
): CloudSkillConfiguredItem {
  return {
    id: "skill_item_1",
    ownerScope: "personal",
    ownerUserId: "user_1",
    organizationId: null,
    skillSourceKind: "plugin",
    skillId: "github-triage",
    skillVersion: null,
    pluginId: "github-package",
    pluginVersion: "1.0.0",
    enabled: true,
    publicToOrg: false,
    publicOrganizationId: null,
    publicStatus: "private",
    configVersion: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}
