import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCloudMcpCatalogMock: vi.fn(),
  listCloudMcpConnectionsMock: vi.fn(),
  createCloudMcpConnectionMock: vi.fn(),
  patchCloudMcpConnectionMock: vi.fn(),
  putCloudMcpSecretAuthMock: vi.fn(),
  deleteCloudMcpConnectionV2Mock: vi.fn(),
}));

vi.mock("@/lib/integrations/cloud/mcp_catalog", () => ({
  getCloudMcpCatalog: mocks.getCloudMcpCatalogMock,
}));

vi.mock("@/lib/integrations/cloud/mcp_connections", () => ({
  listCloudMcpConnections: mocks.listCloudMcpConnectionsMock,
  createCloudMcpConnection: mocks.createCloudMcpConnectionMock,
  patchCloudMcpConnection: mocks.patchCloudMcpConnectionMock,
  putCloudMcpSecretAuth: mocks.putCloudMcpSecretAuthMock,
  deleteCloudMcpConnectionV2: mocks.deleteCloudMcpConnectionV2Mock,
}));

vi.mock("@/lib/integrations/cloud/mcp_oauth", () => ({
  cancelCloudMcpOAuthFlow: vi.fn(),
  getCloudMcpOAuthFlowStatus: vi.fn(),
  startCloudMcpOAuthFlow: vi.fn(),
}));

vi.mock("@/platform/tauri/shell", () => ({
  openExternal: vi.fn(),
}));

import {
  deleteConnector,
  installConnector,
  loadConnectorPaneData,
  setConnectorEnabled,
  updateConnectorSecret,
} from "@/lib/infra/mcp/persistence";

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

function cloudConnection() {
  return {
    connectionId: "conn_1",
    catalogEntryId: "context7",
    catalogEntryVersion: 1,
    serverName: "context7",
    enabled: true,
    settings: {},
    authKind: "secret",
    authStatus: "ready",
    configVersion: 1,
    authVersion: 1,
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
  };
}

describe("cloud MCP connector persistence", () => {
  beforeEach(() => {
    mocks.getCloudMcpCatalogMock.mockReset();
    mocks.listCloudMcpConnectionsMock.mockReset();
    mocks.createCloudMcpConnectionMock.mockReset();
    mocks.patchCloudMcpConnectionMock.mockReset();
    mocks.putCloudMcpSecretAuthMock.mockReset();
    mocks.deleteCloudMcpConnectionV2Mock.mockReset();
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
    mocks.createCloudMcpConnectionMock.mockResolvedValue(cloudConnection());
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
