import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConnectOAuthConnectorResult,
  GetValidOAuthAccessTokenResult,
} from "@/platform/tauri/mcp-oauth";

const mocks = vi.hoisted(() => {
  let persistedState: unknown;
  const connectorSecrets = new Map<string, string>();
  const oauthBundles = new Set<string>();

  return {
    get persistedState() {
      return persistedState;
    },
    set persistedState(value: unknown) {
      persistedState = value;
    },
    connectorSecrets,
    oauthBundles,
    readPersistedValueMock: vi.fn(async () => persistedState),
    persistValueMock: vi.fn(async (_key: string, value: unknown) => {
      persistedState = structuredClone(value);
    }),
    getConnectorSecretMock: vi.fn(async (connectionId: string, fieldId: string) => (
      connectorSecrets.get(`${connectionId}:${fieldId}`) ?? null
    )),
    setConnectorSecretMock: vi.fn(async (connectionId: string, fieldId: string, value: string) => {
      connectorSecrets.set(`${connectionId}:${fieldId}`, value);
    }),
    deleteConnectorSecretMock: vi.fn(async (connectionId: string, fieldId: string) => {
      connectorSecrets.delete(`${connectionId}:${fieldId}`);
    }),
    connectOAuthConnectorMock: vi.fn(async (input: { connectionId: string }): Promise<ConnectOAuthConnectorResult> => {
      oauthBundles.add(input.connectionId);
      return { kind: "completed" as const };
    }),
    getOAuthConnectorBundleStateMock: vi.fn(async (connectionId: string) => ({
      hasBundle: oauthBundles.has(connectionId),
      expiresAt: null,
    })),
    getValidOAuthAccessTokenMock: vi.fn(async (): Promise<GetValidOAuthAccessTokenResult> => ({
      kind: "missing",
    })),
    deleteOAuthConnectorBundleMock: vi.fn(async (connectionId: string) => {
      oauthBundles.delete(connectionId);
    }),
    syncCloudMcpConnectionMock: vi.fn(async () => undefined),
    deleteCloudMcpConnectionMock: vi.fn(async () => undefined),
    commandExistsMock: vi.fn(async () => true),
  };
});

vi.mock("@/lib/infra/preferences-persistence", () => ({
  readPersistedValue: mocks.readPersistedValueMock,
  persistValue: mocks.persistValueMock,
}));

vi.mock("@/platform/tauri/connectors", () => ({
  getConnectorSecret: mocks.getConnectorSecretMock,
  setConnectorSecret: mocks.setConnectorSecretMock,
  deleteConnectorSecret: mocks.deleteConnectorSecretMock,
}));

vi.mock("@/platform/tauri/process", () => ({
  commandExists: mocks.commandExistsMock,
}));

vi.mock("@/platform/tauri/mcp-oauth", () => ({
  connectOAuthConnector: mocks.connectOAuthConnectorMock,
  getOAuthConnectorBundleState: mocks.getOAuthConnectorBundleStateMock,
  getValidOAuthAccessToken: mocks.getValidOAuthAccessTokenMock,
  deleteOAuthConnectorBundle: mocks.deleteOAuthConnectorBundleMock,
}));

vi.mock("@/lib/integrations/cloud/mcp_connections", () => ({
  syncCloudMcpConnection: mocks.syncCloudMcpConnectionMock,
  deleteCloudMcpConnection: mocks.deleteCloudMcpConnectionMock,
}));

import { connectOAuthConnector, installConnector } from "@/lib/infra/mcp/persistence";
import { resolveSessionMcpServersForLaunch } from "@/lib/integrations/anyharness/mcp_launch";

type LaunchContext = Parameters<typeof resolveSessionMcpServersForLaunch>[0];

function launchContext(
  overrides: Omit<LaunchContext, "policy"> & { policy?: Partial<LaunchContext["policy"]> },
): LaunchContext {
  return {
    ...overrides,
    policy: {
      workspaceSurface: "coding",
      lifecycle: "create",
      enabled: true,
      ...overrides.policy,
    },
  };
}

describe("mcp launch resolution", () => {
  beforeEach(() => {
    mocks.persistedState = undefined;
    mocks.connectorSecrets.clear();
    mocks.oauthBundles.clear();
    mocks.readPersistedValueMock.mockClear();
    mocks.persistValueMock.mockClear();
    mocks.getConnectorSecretMock.mockClear();
    mocks.setConnectorSecretMock.mockClear();
    mocks.deleteConnectorSecretMock.mockClear();
    mocks.connectOAuthConnectorMock.mockClear();
    mocks.getOAuthConnectorBundleStateMock.mockClear();
    mocks.getValidOAuthAccessTokenMock.mockClear();
    mocks.deleteOAuthConnectorBundleMock.mockClear();
    mocks.syncCloudMcpConnectionMock.mockClear();
    mocks.deleteCloudMcpConnectionMock.mockClear();
    mocks.commandExistsMock.mockReset();
    mocks.commandExistsMock.mockResolvedValue(true);
    mocks.getValidOAuthAccessTokenMock.mockResolvedValue({
      kind: "missing",
    });
  });

  it("resolves installed http connectors into session MCP servers", async () => {
    await installConnector("context7", "ctx7sk-example");

    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      targetLocation: "local",
      workspacePath: "/workspace",
    }));

    expect(resolution.warnings).toEqual([]);
    expect(resolution.mcpServers).toHaveLength(1);
    expect(resolution.mcpServers[0]).toMatchObject({
      catalogEntryId: "context7",
      transport: "http",
      url: "https://mcp.context7.com/mcp",
    });
    expect(resolution.mcpBindingSummaries).toEqual([
      expect.objectContaining({
        displayName: "Context7",
        outcome: "applied",
        transport: "http",
      }),
    ]);
    expect(JSON.stringify(resolution.mcpBindingSummaries)).not.toContain("ctx7sk-example");
    expect(JSON.stringify(resolution.mcpBindingSummaries)).not.toContain("https://");
    expect(JSON.stringify(resolution.mcpBindingSummaries)).not.toContain("/workspace");
  });

  it("does not resolve coding Powers when the launch policy is disabled", async () => {
    await installConnector("context7", "ctx7sk-example");

    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      targetLocation: "local",
      workspacePath: "/workspace",
      policy: {
        enabled: false,
        includePolicyDisabledSummaries: true,
      },
    }));

    expect(resolution.mcpServers).toEqual([]);
    expect(resolution.warnings).toEqual([]);
    expect(resolution.mcpBindingSummaries).toEqual([
      expect.objectContaining({
        displayName: "Context7",
        outcome: "not_applied",
        reason: "policy_disabled",
      }),
    ]);
  });

  it("resolves Exa API keys into MCP query auth", async () => {
    await installConnector("exa", "exa-example");

    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      targetLocation: "local",
      workspacePath: "/workspace",
    }));

    expect(resolution.warnings).toEqual([]);
    expect(resolution.mcpServers).toHaveLength(1);
    expect(resolution.mcpServers[0]).toMatchObject({
      catalogEntryId: "exa",
      transport: "http",
      url: "https://mcp.exa.ai/mcp?exaApiKey=exa-example",
      headers: [],
    });
  });

  it("warns when an enabled connector is missing its saved secret", async () => {
    await installConnector("context7", "ctx7sk-example");
    const connectionId = (mocks.persistedState as {
      connections: Array<{ connectionId: string }>;
    }).connections[0]!.connectionId;
    mocks.connectorSecrets.delete(`${connectionId}:api_key`);

    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      targetLocation: "local",
      workspacePath: "/workspace",
    }));

    expect(resolution.mcpServers).toEqual([]);
    expect(resolution.warnings).toEqual([
      expect.objectContaining({
        kind: "missing_secret",
        catalogEntryId: "context7",
      }),
    ]);
  });

  it("downgrades unreadable connector secrets into missing-secret warnings", async () => {
    await installConnector("context7", "ctx7sk-example");
    mocks.getConnectorSecretMock.mockRejectedValueOnce(new Error("keychain unavailable"));

    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      targetLocation: "local",
      workspacePath: "/workspace",
    }));

    expect(resolution.mcpServers).toEqual([]);
    expect(resolution.warnings).toEqual([
      expect.objectContaining({
        kind: "missing_secret",
        catalogEntryId: "context7",
      }),
    ]);
  });

  it("skips local-only connectors for cloud launches", async () => {
    await installConnector("filesystem", "");

    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      targetLocation: "cloud",
      workspacePath: "/workspace",
    }));

    expect(resolution.mcpServers).toEqual([]);
    expect(resolution.warnings).toEqual([
      expect.objectContaining({
        kind: "unsupported_target",
        catalogEntryId: "filesystem",
      }),
    ]);
  });

  it("skips stdio connectors when the local command is missing", async () => {
    await installConnector("playwright", "");
    mocks.commandExistsMock.mockResolvedValue(false);

    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      targetLocation: "local",
      workspacePath: "/workspace",
    }));

    expect(resolution.mcpServers).toEqual([]);
    expect(resolution.warnings).toEqual([
      expect.objectContaining({
        kind: "missing_stdio_command",
        catalogEntryId: "playwright",
      }),
    ]);
  });

  it("skips workspace-bound stdio connectors when the workspace path is unavailable", async () => {
    await installConnector("filesystem", "");

    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      targetLocation: "local",
      workspacePath: null,
    }));

    expect(resolution.mcpServers).toEqual([]);
    expect(resolution.warnings).toEqual([
      expect.objectContaining({
        kind: "workspace_path_unresolved",
        catalogEntryId: "filesystem",
      }),
    ]);
    expect(resolution.mcpBindingSummaries).toEqual([
      expect.objectContaining({
        outcome: "not_applied",
        reason: "workspace_path_unresolved",
      }),
    ]);
    expect(JSON.stringify(resolution.mcpBindingSummaries)).not.toContain("/workspace");
  });

  it("downgrades OAuth token refresh failures into reconnect warnings", async () => {
    await connectOAuthConnector("linear");
    mocks.getValidOAuthAccessTokenMock.mockRejectedValueOnce(new Error("refresh failed"));

    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      targetLocation: "cloud",
      workspacePath: "/workspace",
    }));

    expect(resolution.mcpServers).toEqual([]);
    expect(resolution.warnings).toEqual([
      expect.objectContaining({
        kind: "needs_reconnect",
        catalogEntryId: "linear",
      }),
    ]);
  });

  it("injects Gmail OAuth bearer auth into session MCP servers", async () => {
    await connectOAuthConnector("gmail");
    mocks.getValidOAuthAccessTokenMock.mockResolvedValue({
      kind: "ready",
      accessToken: "gmail-token",
      expiresAt: null,
    });

    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      targetLocation: "cloud",
      workspacePath: "/workspace",
    }));

    expect(resolution.warnings).toEqual([]);
    expect(resolution.mcpServers).toHaveLength(1);
    expect(resolution.mcpServers[0]).toMatchObject({
      catalogEntryId: "gmail",
      transport: "http",
      url: "https://gmail.mcp.claude.com/mcp",
      headers: [
        {
          name: "Authorization",
          value: "Bearer gmail-token",
        },
      ],
    });
  });

  it("injects the same OAuth bearer header for local and cloud launches", async () => {
    await connectOAuthConnector("linear");
    mocks.getValidOAuthAccessTokenMock.mockResolvedValue({
      kind: "ready",
      accessToken: "linear-token",
      expiresAt: null,
    });

    const [localResolution, cloudResolution] = await Promise.all([
      resolveSessionMcpServersForLaunch(launchContext({
        targetLocation: "local",
        workspacePath: "/workspace",
      })),
      resolveSessionMcpServersForLaunch(launchContext({
        targetLocation: "cloud",
        workspacePath: "/workspace",
      })),
    ]);

    expect(localResolution.warnings).toEqual([]);
    expect(cloudResolution.warnings).toEqual([]);
    expect(localResolution.mcpServers).toHaveLength(1);
    expect(cloudResolution.mcpServers).toHaveLength(1);
    expect(localResolution.mcpServers[0]).toMatchObject({
      catalogEntryId: "linear",
      transport: "http",
      url: "https://mcp.linear.app/mcp",
      headers: [
        {
          name: "Authorization",
          value: "Bearer linear-token",
        },
      ],
    });
    expect(cloudResolution.mcpServers[0]).toMatchObject({
      catalogEntryId: "linear",
      transport: "http",
      url: "https://mcp.linear.app/mcp",
      headers: [
        {
          name: "Authorization",
          value: "Bearer linear-token",
        },
      ],
    });
  });
});
