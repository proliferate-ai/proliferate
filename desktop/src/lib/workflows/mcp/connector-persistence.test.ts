import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCloudMcpCatalogMock: vi.fn(),
  listCloudMcpConnectionsMock: vi.fn(),
  createCloudMcpConnectionMock: vi.fn(),
  patchCloudMcpConnectionMock: vi.fn(),
  publicizeCloudMcpConnectionMock: vi.fn(),
  unpublicizeCloudMcpConnectionMock: vi.fn(),
  putCloudMcpSecretAuthMock: vi.fn(),
  deleteCloudMcpConnectionV2Mock: vi.fn(),
  listConfiguredPluginsMock: vi.fn(),
  installConfiguredPluginMock: vi.fn(),
  patchConfiguredPluginMock: vi.fn(),
  listConfiguredSkillsMock: vi.fn(),
  patchConfiguredSkillMock: vi.fn(),
  startGoogleWorkspaceMcpAuthMock: vi.fn(),
  cancelGoogleWorkspaceMcpAuthMock: vi.fn(),
  deleteGoogleWorkspaceMcpLocalDataMock: vi.fn(),
  reconcileGoogleWorkspaceMcpPendingSetupsMock: vi.fn(),
  getGoogleWorkspaceMcpCredentialStatusMock: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk/client/mcp_catalog", () => ({
  getCloudMcpCatalog: mocks.getCloudMcpCatalogMock,
}));

vi.mock("@proliferate/cloud-sdk/client/mcp_connections", () => ({
  listCloudMcpConnections: mocks.listCloudMcpConnectionsMock,
  createCloudMcpConnection: mocks.createCloudMcpConnectionMock,
  patchCloudMcpConnection: mocks.patchCloudMcpConnectionMock,
  publicizeCloudMcpConnection: mocks.publicizeCloudMcpConnectionMock,
  unpublicizeCloudMcpConnection: mocks.unpublicizeCloudMcpConnectionMock,
  putCloudMcpSecretAuth: mocks.putCloudMcpSecretAuthMock,
  deleteCloudMcpConnectionV2: mocks.deleteCloudMcpConnectionV2Mock,
}));

vi.mock("@proliferate/cloud-sdk/client/plugins", () => ({
  listConfiguredPlugins: mocks.listConfiguredPluginsMock,
  installConfiguredPlugin: mocks.installConfiguredPluginMock,
  patchConfiguredPlugin: mocks.patchConfiguredPluginMock,
}));

vi.mock("@proliferate/cloud-sdk/client/skills", () => ({
  listConfiguredSkills: mocks.listConfiguredSkillsMock,
  patchConfiguredSkill: mocks.patchConfiguredSkillMock,
}));

vi.mock("@proliferate/cloud-sdk/client/mcp_oauth", () => ({
  cancelCloudMcpOAuthFlow: vi.fn(),
  getCloudMcpOAuthFlowStatus: vi.fn(),
  startCloudMcpOAuthFlow: vi.fn(),
}));

vi.mock("@/lib/access/tauri/shell", () => ({
  openExternal: vi.fn(),
}));

vi.mock("@/lib/access/tauri/google-workspace-mcp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/access/tauri/google-workspace-mcp")>();
  return {
    ...actual,
    startGoogleWorkspaceMcpAuth: mocks.startGoogleWorkspaceMcpAuthMock,
    cancelGoogleWorkspaceMcpAuth: mocks.cancelGoogleWorkspaceMcpAuthMock,
    deleteGoogleWorkspaceMcpLocalData: mocks.deleteGoogleWorkspaceMcpLocalDataMock,
    reconcileGoogleWorkspaceMcpPendingSetups: mocks.reconcileGoogleWorkspaceMcpPendingSetupsMock,
    getGoogleWorkspaceMcpCredentialStatus: mocks.getGoogleWorkspaceMcpCredentialStatusMock,
  };
});

import {
  cancelLocalOAuthConnectorConnect,
  deleteConnector,
  installConnector,
  loadConnectorPaneData,
  setConnectorPublicExposure,
  setConnectorEnabled,
  updateConnectorSecret,
} from "@/lib/workflows/mcp/connector-persistence";

function secretCatalogEntry(id = "context7") {
  const secretFields = [
    {
      id: "api_key",
      label: "API key",
      placeholder: "key",
      helperText: "key",
      getTokenInstructions: "key",
      prefixHint: null,
    },
  ];
  return {
    id,
    name: "Context7",
    oneLiner: "Docs",
    description: "Docs",
    docsUrl: "https://example.com",
    availability: "universal",
    cloudSecretSync: true,
    transport: "http",
    authKind: "secret",
    authStyle: { kind: "bearer" },
    authFieldId: "api_key",
    url: "https://mcp.example.com/mcp",
    displayUrl: "https://mcp.example.com/mcp",
    serverNameBase: id,
    iconId: "context7",
    secretFields,
    requiredFields: secretFields,
    settingsSchema: [],
    capabilities: ["Read docs"],
    version: 1,
  };
}

function posthogCatalogEntry() {
  return {
    ...secretCatalogEntry("posthog"),
    name: "PostHog",
    serverNameBase: "posthog",
    iconId: "posthog",
    authFieldId: "apiKey",
    secretFields: [
      {
        id: "apiKey",
        label: "Project API key",
        placeholder: "phx_...",
        helperText: "key",
        getTokenInstructions: "key",
        prefixHint: "phx_",
      },
    ],
    requiredFields: [
      {
        id: "apiKey",
        label: "Project API key",
        placeholder: "phx_...",
        helperText: "key",
        getTokenInstructions: "key",
        prefixHint: "phx_",
      },
    ],
    settingsSchema: [
      {
        id: "region",
        kind: "select",
        label: "Region",
        placeholder: "",
        helperText: "Region",
        required: true,
        defaultValue: "us",
        options: [
          { value: "us", label: "US" },
          { value: "eu", label: "EU" },
        ],
        affectsUrl: true,
      },
    ],
  };
}

function stdioCatalogEntry() {
  return {
    id: "filesystem",
    name: "Filesystem",
    oneLiner: "Files",
    description: "Files",
    docsUrl: "https://example.com",
    availability: "local_only",
    cloudSecretSync: false,
    transport: "stdio",
    command: "npx",
    args: [{ source: { kind: "workspace_path" } }],
    env: [],
    serverNameBase: "filesystem",
    iconId: "folder",
    displayUrl: "",
    secretFields: [],
    requiredFields: [],
    settingsSchema: [],
    capabilities: ["Read files"],
    version: 1,
  };
}

function noAuthHttpCatalogEntry() {
  return {
    id: "local_http",
    name: "Local HTTP",
    oneLiner: "Local HTTP",
    description: "Local HTTP",
    docsUrl: "https://example.com",
    availability: "local_only",
    cloudSecretSync: false,
    transport: "http",
    authKind: "none",
    url: "https://example.com/mcp",
    displayUrl: "https://example.com/mcp",
    serverNameBase: "local_http",
    iconId: "globe",
    secretFields: [],
    requiredFields: [],
    settingsSchema: [],
    capabilities: ["Run without credentials"],
    version: 1,
  };
}

function gmailCatalogEntry() {
  return {
    id: "gmail",
    name: "Gmail",
    oneLiner: "Gmail",
    description: "Gmail",
    docsUrl: "https://example.com",
    availability: "local_only",
    cloudSecretSync: false,
    setupKind: "local_oauth",
    transport: "stdio",
    command: "uvx",
    args: [],
    env: [
      { name: "GOOGLE_OAUTH_CLIENT_ID", source: { kind: "static", value: "client-id" } },
      { name: "GOOGLE_OAUTH_CLIENT_SECRET", source: { kind: "static", value: "client-secret" } },
    ],
    serverNameBase: "gmail",
    iconId: "gmail",
    displayUrl: "",
    secretFields: [],
    requiredFields: [],
    settingsSchema: [
      {
        id: "userGoogleEmail",
        kind: "string",
        label: "Google account email",
        placeholder: "name@example.com",
        helperText: "The Gmail account authorized on this desktop.",
        required: true,
        defaultValue: null,
        options: [],
        affectsUrl: false,
      },
    ],
    capabilities: ["Search Gmail"],
    version: 1,
  };
}

function cloudConnection() {
  return {
    connectionId: "conn_1",
    ownerScope: "personal",
    ownerUserId: "user_1",
    organizationId: null,
    catalogEntryId: "context7",
    catalogEntryVersion: 1,
    serverName: "context7",
    enabled: true,
    publicToOrg: false,
    publicOrganizationId: null,
    publicStatus: "private",
    publicUpdatedAt: null,
    publicUpdatedByUserId: null,
    settings: {},
    authKind: "secret",
    authStatus: "ready",
    configVersion: 1,
    authVersion: 1,
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
  };
}

function configuredPluginItem() {
  return {
    id: "plugin_item_1",
    ownerScope: "personal",
    ownerUserId: "user_1",
    organizationId: null,
    pluginId: "github",
    pluginVersion: "1",
    enabled: true,
    publicToOrg: false,
    publicOrganizationId: null,
    publicStatus: "private",
    configVersion: 1,
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
  };
}

function configuredSkillItem() {
  return {
    id: "skill_item_1",
    ownerScope: "personal",
    ownerUserId: "user_1",
    organizationId: null,
    skillSourceKind: "plugin",
    skillId: "triage",
    skillVersion: null,
    pluginId: "github",
    pluginVersion: "1",
    enabled: true,
    publicToOrg: false,
    publicOrganizationId: null,
    publicStatus: "private",
    configVersion: 1,
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
  };
}

function githubPluginPackage() {
  return {
    id: "github",
    catalogEntryId: "github",
    version: "1",
    displayName: "GitHub",
    description: "GitHub package",
    skills: [
      {
        id: "triage",
        displayName: "GitHub triage",
        description: "Inspect GitHub.",
        instructions: "# GitHub triage",
        requiredMcpServerRefs: ["github"],
        requiresCredentialBinding: true,
        resources: [],
        defaultEnabled: true,
        provenance: {
          sourceRepoUrl: "https://example.com",
          sourcePath: "skills/github/SKILL.md",
          sourceRef: "test",
          sourceSha256: "source",
          adaptedSha256: "adapted",
          sourceLicense: "MIT",
          importMode: "adapted",
          reviewStatus: "reviewed",
          reviewer: "test",
          reviewedAt: "2026-05-13",
          notes: "",
        },
      },
    ],
  };
}

describe("cloud MCP connector persistence", () => {
  beforeEach(() => {
    mocks.getCloudMcpCatalogMock.mockReset();
    mocks.listCloudMcpConnectionsMock.mockReset();
    mocks.createCloudMcpConnectionMock.mockReset();
    mocks.patchCloudMcpConnectionMock.mockReset();
    mocks.publicizeCloudMcpConnectionMock.mockReset();
    mocks.unpublicizeCloudMcpConnectionMock.mockReset();
    mocks.putCloudMcpSecretAuthMock.mockReset();
    mocks.deleteCloudMcpConnectionV2Mock.mockReset();
    mocks.listConfiguredPluginsMock.mockReset();
    mocks.installConfiguredPluginMock.mockReset();
    mocks.patchConfiguredPluginMock.mockReset();
    mocks.listConfiguredSkillsMock.mockReset();
    mocks.patchConfiguredSkillMock.mockReset();
    mocks.startGoogleWorkspaceMcpAuthMock.mockReset();
    mocks.cancelGoogleWorkspaceMcpAuthMock.mockReset();
    mocks.deleteGoogleWorkspaceMcpLocalDataMock.mockReset();
    mocks.reconcileGoogleWorkspaceMcpPendingSetupsMock.mockReset();
    mocks.getGoogleWorkspaceMcpCredentialStatusMock.mockReset();
    mocks.getCloudMcpCatalogMock.mockResolvedValue({
      catalogVersion: "test",
      entries: [
        secretCatalogEntry(),
        posthogCatalogEntry(),
        stdioCatalogEntry(),
        noAuthHttpCatalogEntry(),
      ],
    });
    mocks.listCloudMcpConnectionsMock.mockResolvedValue({
      connections: [cloudConnection()],
    });
    mocks.listConfiguredPluginsMock.mockResolvedValue({ plugins: [] });
    mocks.listConfiguredSkillsMock.mockResolvedValue({ skills: [] });
    mocks.createCloudMcpConnectionMock.mockResolvedValue(cloudConnection());
    mocks.deleteCloudMcpConnectionV2Mock.mockResolvedValue(undefined);
    mocks.installConfiguredPluginMock.mockResolvedValue(configuredPluginItem());
    mocks.patchConfiguredPluginMock.mockResolvedValue(configuredPluginItem());
    mocks.patchConfiguredSkillMock.mockResolvedValue(configuredSkillItem());
    mocks.publicizeCloudMcpConnectionMock.mockResolvedValue({
      ...cloudConnection(),
      publicToOrg: true,
      publicOrganizationId: "org_1",
      publicStatus: "public",
    });
    mocks.unpublicizeCloudMcpConnectionMock.mockResolvedValue(cloudConnection());
    mocks.startGoogleWorkspaceMcpAuthMock.mockResolvedValue({
      status: "completed",
      userGoogleEmail: "user@example.com",
    });
    mocks.cancelGoogleWorkspaceMcpAuthMock.mockResolvedValue({ ok: true });
    mocks.deleteGoogleWorkspaceMcpLocalDataMock.mockResolvedValue({ status: "deleted" });
    mocks.reconcileGoogleWorkspaceMcpPendingSetupsMock.mockResolvedValue({ ok: true });
    mocks.getGoogleWorkspaceMcpCredentialStatusMock.mockResolvedValue({ status: "ready" });
  });

  it("loads catalog and installed connectors from cloud", async () => {
    const paneData = await loadConnectorPaneData();

    expect(mocks.getCloudMcpCatalogMock).toHaveBeenCalledTimes(1);
    expect(mocks.listCloudMcpConnectionsMock).toHaveBeenCalledTimes(1);
    expect(paneData.installed).toHaveLength(1);
    expect(paneData.installed[0]?.catalogEntry.id).toBe("context7");
    expect(paneData.available.map((entry) => entry.id)).toEqual([
      "posthog",
      "filesystem",
      "local_http",
    ]);
  });

  it("attaches plugin package skills from the cloud catalog", async () => {
    mocks.getCloudMcpCatalogMock.mockResolvedValue({
      catalogVersion: "test",
      entries: [secretCatalogEntry("github")],
      pluginPackages: [
        {
          id: "github",
          catalogEntryId: "github",
          version: "1",
          displayName: "GitHub",
          description: "GitHub package",
          skills: [
            {
              id: "triage",
              displayName: "GitHub triage",
              description: "Inspect GitHub.",
              instructions: "# GitHub triage",
              requiredMcpServerRefs: ["github"],
              requiresCredentialBinding: true,
              resources: [],
              defaultEnabled: true,
              provenance: {
                sourceRepoUrl: "https://example.com",
                sourcePath: "skills/github/SKILL.md",
                sourceRef: "test",
                sourceSha256: "source",
                adaptedSha256: "adapted",
                sourceLicense: "MIT",
                importMode: "adapted",
                reviewStatus: "reviewed",
                reviewer: "test",
                reviewedAt: "2026-05-13",
                notes: "",
              },
            },
          ],
        },
      ],
    });
    mocks.listCloudMcpConnectionsMock.mockResolvedValue({
      connections: [],
    });

    const paneData = await loadConnectorPaneData();

    expect(paneData.available[0]?.pluginPackage?.skills[0]?.id).toBe("triage");
    expect(paneData.available[0]?.pluginPackage?.skills[0]?.provenance?.sourceSha256)
      .toBe("source");
  });

  it("maps configured MCP, plugin, and skill public state onto installed records", async () => {
    mocks.getCloudMcpCatalogMock.mockResolvedValue({
      catalogVersion: "test",
      entries: [secretCatalogEntry("github")],
      pluginPackages: [githubPluginPackage()],
    });
    mocks.listCloudMcpConnectionsMock.mockResolvedValue({
      connections: [{
        ...cloudConnection(),
        connectionId: "conn_github",
        catalogEntryId: "github",
        serverName: "github",
        publicToOrg: true,
        publicOrganizationId: "org_1",
        publicStatus: "public",
      }],
    });
    mocks.listConfiguredPluginsMock.mockResolvedValue({
      plugins: [{
        ...configuredPluginItem(),
        publicToOrg: true,
        publicOrganizationId: "org_1",
        publicStatus: "public",
      }],
    });
    mocks.listConfiguredSkillsMock.mockResolvedValue({
      skills: [{
        ...configuredSkillItem(),
        publicToOrg: true,
        publicOrganizationId: "org_1",
        publicStatus: "public",
      }],
    });

    const paneData = await loadConnectorPaneData();

    expect(paneData.installed[0]?.metadata.publicToOrg).toBe(true);
    expect(paneData.installed[0]?.metadata.publicOrganizationId).toBe("org_1");
    expect(paneData.installed[0]?.metadata.configuredPlugin).toMatchObject({
      id: "plugin_item_1",
      kind: "plugin",
      sourceId: "github",
      publicToOrg: true,
      publicStatus: "public",
    });
    expect(paneData.installed[0]?.metadata.configuredSkills).toEqual([
      expect.objectContaining({
        id: "skill_item_1",
        kind: "skill",
        sourceId: "triage",
        publicToOrg: true,
        publicStatus: "public",
      }),
    ]);
  });

  it("publicizes and unpublicizes configured MCP, plugin, and skill items together", async () => {
    mocks.getCloudMcpCatalogMock.mockResolvedValue({
      catalogVersion: "test",
      entries: [secretCatalogEntry("github")],
      pluginPackages: [githubPluginPackage()],
    });
    mocks.listCloudMcpConnectionsMock.mockResolvedValue({
      connections: [{
        ...cloudConnection(),
        connectionId: "conn_github",
        catalogEntryId: "github",
        serverName: "github",
      }],
    });
    mocks.listConfiguredPluginsMock.mockResolvedValue({
      plugins: [configuredPluginItem()],
    });
    mocks.listConfiguredSkillsMock.mockResolvedValue({
      skills: [configuredSkillItem()],
    });
    const record = (await loadConnectorPaneData()).installed[0]!;

    await setConnectorPublicExposure(record, "org_1", true);
    await setConnectorPublicExposure(record, "org_1", false);

    expect(mocks.publicizeCloudMcpConnectionMock).toHaveBeenCalledWith("conn_github", {
      organizationId: "org_1",
    });
    expect(mocks.unpublicizeCloudMcpConnectionMock).toHaveBeenCalledWith("conn_github");
    expect(mocks.patchConfiguredPluginMock).toHaveBeenCalledWith("plugin_item_1", {
      publicToOrg: true,
      publicOrganizationId: "org_1",
    });
    expect(mocks.patchConfiguredPluginMock).toHaveBeenCalledWith("plugin_item_1", {
      publicToOrg: false,
      publicOrganizationId: null,
    });
    expect(mocks.patchConfiguredSkillMock).toHaveBeenCalledWith("skill_item_1", {
      publicToOrg: true,
      publicOrganizationId: "org_1",
    });
    expect(mocks.patchConfiguredSkillMock).toHaveBeenCalledWith("skill_item_1", {
      publicToOrg: false,
      publicOrganizationId: null,
    });
  });

  it("drops installed rows whose catalog entry was removed", async () => {
    mocks.listCloudMcpConnectionsMock.mockResolvedValue({
      connections: [
        cloudConnection(),
        {
          ...cloudConnection(),
          connectionId: "conn_removed",
          catalogEntryId: "removed_connector",
        },
      ],
    });

    const paneData = await loadConnectorPaneData();

    expect(paneData.installed.map((record) => record.metadata.connectionId)).toEqual(["conn_1"]);
  });

  it("installs API-key connectors by creating cloud connection auth", async () => {
    await installConnector("context7", { api_key: "ctx7sk-example" });

    expect(mocks.createCloudMcpConnectionMock).toHaveBeenCalledWith({
      catalogEntryId: "context7",
      settings: undefined,
      enabled: true,
    });
    expect(mocks.putCloudMcpSecretAuthMock).toHaveBeenCalledWith("conn_1", {
      secretFields: { api_key: "ctx7sk-example" },
    });
  });

  it("creates settings-backed API-key connections before writing secrets", async () => {
    await installConnector("posthog", { apiKey: "phx_example" }, { region: "eu" });

    expect(mocks.createCloudMcpConnectionMock).toHaveBeenCalledWith({
      catalogEntryId: "posthog",
      settings: { region: "eu" },
      enabled: true,
    });
    expect(mocks.putCloudMcpSecretAuthMock).toHaveBeenCalledWith("conn_1", {
      secretFields: { apiKey: "phx_example" },
    });
    expect(
      mocks.createCloudMcpConnectionMock.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.putCloudMcpSecretAuthMock.mock.invocationCallOrder[0] ?? 0);
  });

  it("installs no-auth HTTP connectors without writing secret auth", async () => {
    await installConnector("local_http", {});

    expect(mocks.createCloudMcpConnectionMock).toHaveBeenCalledWith({
      catalogEntryId: "local_http",
      settings: undefined,
      enabled: true,
    });
    expect(mocks.putCloudMcpSecretAuthMock).not.toHaveBeenCalled();
  });

  it("rolls back Gmail if local OAuth is canceled while cloud connection creation is in flight", async () => {
    mocks.getCloudMcpCatalogMock.mockResolvedValue({
      catalogVersion: "test",
      entries: [gmailCatalogEntry()],
    });
    mocks.listCloudMcpConnectionsMock.mockResolvedValue({ connections: [] });
    let resolveCreate: ((connection: ReturnType<typeof cloudConnection>) => void) | undefined;
    mocks.createCloudMcpConnectionMock.mockImplementation(() => new Promise((resolve) => {
      resolveCreate = resolve;
    }));

    const installPromise = installConnector("gmail", {});
    await vi.waitFor(() => {
      expect(mocks.createCloudMcpConnectionMock).toHaveBeenCalled();
    });
    await cancelLocalOAuthConnectorConnect();
    resolveCreate?.({
      ...cloudConnection(),
      connectionId: "conn_gmail",
      catalogEntryId: "gmail",
      serverName: "gmail",
      authKind: "none",
      settings: { userGoogleEmail: "user@example.com" },
    });

    await expect(installPromise).rejects.toMatchObject({ code: "cancelled" });
    expect(mocks.cancelGoogleWorkspaceMcpAuthMock).toHaveBeenCalledWith({
      setupId: expect.any(String),
    });
    expect(mocks.deleteCloudMcpConnectionV2Mock).toHaveBeenCalledWith("conn_gmail");
    expect(mocks.deleteGoogleWorkspaceMcpLocalDataMock).toHaveBeenCalledWith({
      setupId: expect.any(String),
      userGoogleEmail: "user@example.com",
    });
    expect(mocks.reconcileGoogleWorkspaceMcpPendingSetupsMock).not.toHaveBeenCalled();
  });

  it("updates connector secret in cloud", async () => {
    await updateConnectorSecret("conn_1", { api_key: "ctx7sk-updated" });

    expect(mocks.putCloudMcpSecretAuthMock).toHaveBeenCalledWith("conn_1", {
      secretFields: { api_key: "ctx7sk-updated" },
    });
  });

  it("toggles and deletes cloud connections", async () => {
    await setConnectorEnabled("conn_1", false);
    await deleteConnector("conn_1");

    expect(mocks.patchCloudMcpConnectionMock).toHaveBeenCalledWith("conn_1", {
      enabled: false,
    });
    expect(mocks.deleteCloudMcpConnectionV2Mock).toHaveBeenCalledWith("conn_1");
  });
});
