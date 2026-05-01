import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  commandExistsMock: vi.fn(async () => true),
  materializeCloudMcpServersMock: vi.fn(),
  resolveGoogleWorkspaceMcpRuntimeEnvMock: vi.fn(),
}));

vi.mock("@/platform/tauri/process", () => ({
  commandExists: mocks.commandExistsMock,
}));

vi.mock("@/lib/integrations/cloud/mcp_materialization", () => ({
  materializeCloudMcpServers: mocks.materializeCloudMcpServersMock,
}));

vi.mock("@/platform/tauri/google-workspace-mcp", () => ({
  resolveGoogleWorkspaceMcpRuntimeEnv: mocks.resolveGoogleWorkspaceMcpRuntimeEnvMock,
}));

import {
  COWORK_WORKSPACE_PATH_PLACEHOLDER,
  resolveSessionMcpServersForLaunch,
} from "@/lib/integrations/anyharness/mcp_launch";

type LaunchContext = Parameters<typeof resolveSessionMcpServersForLaunch>[0];

function launchContext(
  overrides: Omit<LaunchContext, "policy" | "launchId"> & {
    launchId?: string;
    policy?: Partial<LaunchContext["policy"]>;
  },
): LaunchContext {
  return {
    launchId: "test-launch",
    ...overrides,
    policy: {
      workspaceSurface: "coding",
      lifecycle: "create",
      enabled: true,
      ...overrides.policy,
    },
  };
}

function materialized(overrides?: Record<string, unknown>) {
  return {
    catalogVersion: "test",
    mcpServers: [],
    mcpBindingSummaries: [],
    localStdioCandidates: [],
    warnings: [],
    ...overrides,
  };
}

describe("cloud MCP launch resolution", () => {
  beforeEach(() => {
    mocks.commandExistsMock.mockReset();
    mocks.commandExistsMock.mockResolvedValue(true);
    mocks.materializeCloudMcpServersMock.mockReset();
    mocks.materializeCloudMcpServersMock.mockResolvedValue(materialized());
    mocks.resolveGoogleWorkspaceMcpRuntimeEnvMock.mockReset();
    mocks.resolveGoogleWorkspaceMcpRuntimeEnvMock.mockResolvedValue({
      status: "ready",
      env: [],
    });
  });

  it("uses cloud materialization for concrete remote MCP servers", async () => {
    mocks.materializeCloudMcpServersMock.mockResolvedValue(materialized({
      mcpServers: [
        {
          transport: "http",
          connectionId: "conn_context7",
          catalogEntryId: "context7",
          serverName: "context7",
          url: "https://mcp.context7.com/mcp",
          headers: [{ name: "Authorization", value: "Bearer token" }],
        },
      ],
      mcpBindingSummaries: [
        {
          id: "conn_context7",
          serverName: "context7",
          displayName: "Context7",
          transport: "http",
          outcome: "applied",
        },
      ],
    }));

    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      targetLocation: "cloud",
      workspacePath: "/workspace",
    }));

    expect(mocks.materializeCloudMcpServersMock).toHaveBeenCalledWith({
      targetLocation: "cloud",
    });
    expect(resolution.warnings).toEqual([]);
    expect(resolution.mcpServers).toEqual([
      expect.objectContaining({
        catalogEntryId: "context7",
        transport: "http",
        url: "https://mcp.context7.com/mcp",
      }),
    ]);
    expect(resolution.mcpBindingSummaries).toEqual([
      expect.objectContaining({
        displayName: "Context7",
        outcome: "applied",
        transport: "http",
      }),
    ]);
    expect(JSON.stringify(resolution.mcpBindingSummaries)).not.toContain("Bearer token");
    expect(JSON.stringify(resolution.mcpBindingSummaries)).not.toContain("/workspace");
  });

  it("does not call cloud materialization when launch policy is disabled", async () => {
    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      targetLocation: "local",
      workspacePath: "/workspace",
      policy: {
        enabled: false,
        includePolicyDisabledSummaries: true,
      },
    }));

    expect(mocks.materializeCloudMcpServersMock).not.toHaveBeenCalled();
    expect(resolution).toEqual({
      mcpServers: [],
      mcpBindingSummaries: [],
      warnings: [],
    });
  });

  it("finalizes local stdio candidates without sending workspace paths to cloud", async () => {
    mocks.materializeCloudMcpServersMock.mockResolvedValue(materialized({
      mcpBindingSummaries: [
        {
          id: "conn_filesystem",
          serverName: "filesystem",
          displayName: "Filesystem",
          transport: "stdio",
          outcome: "applied",
        },
      ],
      localStdioCandidates: [
        {
          connectionId: "conn_filesystem",
          catalogEntryId: "filesystem",
          serverName: "filesystem",
          connectorName: "Filesystem",
          command: "npx",
          args: [{ source: { kind: "workspace_path" } }],
          env: [],
        },
      ],
    }));

    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      targetLocation: "local",
      workspacePath: "/workspace",
    }));

    expect(mocks.materializeCloudMcpServersMock).toHaveBeenCalledWith({
      targetLocation: "local",
    });
    expect(JSON.stringify(mocks.materializeCloudMcpServersMock.mock.calls)).not.toContain(
      "/workspace",
    );
    expect(resolution.warnings).toEqual([]);
    expect(resolution.mcpServers).toEqual([
      expect.objectContaining({
        args: ["/workspace"],
        catalogEntryId: "filesystem",
        transport: "stdio",
      }),
    ]);
    expect(resolution.mcpBindingSummaries).toEqual([
      expect.objectContaining({
        id: "conn_filesystem",
        outcome: "applied",
        transport: "stdio",
      }),
    ]);
  });

  it("preserves resolved stdio env values but keeps them out of summaries", async () => {
    mocks.materializeCloudMcpServersMock.mockResolvedValue(materialized({
      mcpBindingSummaries: [
        {
          id: "conn_secret_stdio",
          serverName: "secret_stdio",
          displayName: "Secret Stdio",
          transport: "stdio",
          outcome: "applied",
        },
      ],
      localStdioCandidates: [
        {
          connectionId: "conn_secret_stdio",
          catalogEntryId: "secret_stdio",
          serverName: "secret_stdio",
          connectorName: "Secret Stdio",
          command: "secret-stdio",
          args: [{ source: { kind: "static", value: "readonly" } }],
          env: [{ name: "API_KEY", source: { kind: "static", value: "secret-token" } }],
        },
      ],
    }));

    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      targetLocation: "local",
      workspacePath: "/workspace",
    }));

    expect(resolution.warnings).toEqual([]);
    expect(resolution.mcpServers).toEqual([
      expect.objectContaining({
        args: ["readonly"],
        env: [{ name: "API_KEY", value: "secret-token" }],
        transport: "stdio",
      }),
    ]);
    expect(JSON.stringify(resolution.mcpBindingSummaries)).not.toContain("secret-token");
  });

  it("fails unsupported stdio launch sources instead of substituting empty strings", async () => {
    mocks.materializeCloudMcpServersMock.mockResolvedValue(materialized({
      mcpBindingSummaries: [
        {
          id: "conn_secret_stdio",
          serverName: "secret_stdio",
          displayName: "Secret Stdio",
          transport: "stdio",
          outcome: "applied",
        },
      ],
      localStdioCandidates: [
        {
          connectionId: "conn_secret_stdio",
          catalogEntryId: "secret_stdio",
          serverName: "secret_stdio",
          connectorName: "Secret Stdio",
          command: "secret-stdio",
          args: [],
          env: [{ name: "API_KEY", source: { kind: "secret", fieldId: "api_key" } }],
        },
      ],
    }));

    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      targetLocation: "local",
      workspacePath: "/workspace",
    }));

    expect(resolution.mcpServers).toEqual([]);
    expect(resolution.warnings).toEqual([
      expect.objectContaining({ kind: "resolver_error", catalogEntryId: "secret_stdio" }),
    ]);
    expect(resolution.mcpBindingSummaries).toEqual([
      expect.objectContaining({
        outcome: "not_applied",
        reason: "resolver_error",
      }),
    ]);
  });

  it("converts missing stdio commands into not-applied summaries", async () => {
    mocks.commandExistsMock.mockResolvedValue(false);
    mocks.materializeCloudMcpServersMock.mockResolvedValue(materialized({
      mcpBindingSummaries: [
        {
          id: "conn_playwright",
          serverName: "playwright",
          displayName: "Playwright",
          transport: "stdio",
          outcome: "applied",
        },
      ],
      localStdioCandidates: [
        {
          connectionId: "conn_playwright",
          catalogEntryId: "playwright",
          serverName: "playwright",
          connectorName: "Playwright",
          command: "npx",
          args: [],
          env: [],
        },
      ],
    }));

    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      targetLocation: "local",
      workspacePath: "/workspace",
    }));

    expect(resolution.mcpServers).toEqual([]);
    expect(resolution.warnings).toEqual([
      expect.objectContaining({
        kind: "command_missing",
        catalogEntryId: "playwright",
      }),
    ]);
    expect(resolution.mcpBindingSummaries).toEqual([
      expect.objectContaining({
        outcome: "not_applied",
        reason: "resolver_error",
      }),
    ]);
  });

  it("keeps cowork workspace-bound stdio connectors resolvable before thread path exists", async () => {
    mocks.materializeCloudMcpServersMock.mockResolvedValue(materialized({
      mcpBindingSummaries: [
        {
          id: "conn_filesystem",
          serverName: "filesystem",
          displayName: "Filesystem",
          transport: "stdio",
          outcome: "applied",
        },
      ],
      localStdioCandidates: [
        {
          connectionId: "conn_filesystem",
          catalogEntryId: "filesystem",
          serverName: "filesystem",
          connectorName: "Filesystem",
          command: "npx",
          args: [{ source: { kind: "workspace_path" } }],
          env: [],
        },
      ],
    }));

    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      targetLocation: "local",
      workspacePath: COWORK_WORKSPACE_PATH_PLACEHOLDER,
      policy: {
        workspaceSurface: "cowork",
      },
    }));

    expect(resolution.warnings).toEqual([]);
    expect(resolution.mcpServers).toEqual([
      expect.objectContaining({
        args: [COWORK_WORKSPACE_PATH_PLACEHOLDER],
        catalogEntryId: "filesystem",
        transport: "stdio",
      }),
    ]);
  });

  it("injects Gmail local OAuth env without leaking email into summaries", async () => {
    mocks.resolveGoogleWorkspaceMcpRuntimeEnvMock.mockResolvedValue({
      status: "ready",
      env: [
        { name: "USER_GOOGLE_EMAIL", value: "user@example.com" },
        { name: "WORKSPACE_MCP_CREDENTIALS_DIR", value: "/local/private/credentials" },
      ],
    });
    mocks.materializeCloudMcpServersMock.mockResolvedValue(materialized({
      localStdioCandidates: [
        {
          connectionId: "conn_gmail",
          catalogEntryId: "gmail",
          serverName: "gmail",
          connectorName: "Gmail",
          setupKind: "local_oauth",
          localOauth: {
            provider: "google_workspace",
            userGoogleEmail: "user@example.com",
            requiredScope: "https://www.googleapis.com/auth/gmail.readonly",
          },
          command: "uvx",
          args: [{ source: { kind: "static", value: "workspace-mcp" } }],
          env: [{ name: "GOOGLE_OAUTH_CLIENT_ID", source: { kind: "static", value: "client-id" } }],
        },
      ],
    }));

    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      targetLocation: "local",
      workspacePath: "/workspace",
      launchId: "launch-gmail",
    }));

    expect(mocks.resolveGoogleWorkspaceMcpRuntimeEnvMock).toHaveBeenCalledWith({
      connectionId: "conn_gmail",
      userGoogleEmail: "user@example.com",
      launchId: "launch-gmail",
    });
    expect(resolution.mcpServers).toEqual([
      expect.objectContaining({
        catalogEntryId: "gmail",
        env: expect.arrayContaining([
          { name: "GOOGLE_OAUTH_CLIENT_ID", value: "client-id" },
          { name: "USER_GOOGLE_EMAIL", value: "user@example.com" },
        ]),
      }),
    ]);
    const summaryJson = JSON.stringify(resolution.mcpBindingSummaries);
    expect(summaryJson).not.toContain("user@example.com");
    expect(summaryJson).not.toContain("/local/private");
  });

  it("marks Gmail local OAuth candidates as needing reconnect when credentials are missing", async () => {
    mocks.resolveGoogleWorkspaceMcpRuntimeEnvMock.mockResolvedValue({
      status: "not_ready",
      code: "credential_missing",
    });
    mocks.materializeCloudMcpServersMock.mockResolvedValue(materialized({
      localStdioCandidates: [
        {
          connectionId: "conn_gmail",
          catalogEntryId: "gmail",
          serverName: "gmail",
          connectorName: "Gmail",
          setupKind: "local_oauth",
          localOauth: {
            provider: "google_workspace",
            userGoogleEmail: "user@example.com",
            requiredScope: "https://www.googleapis.com/auth/gmail.readonly",
          },
          command: "uvx",
          args: [],
          env: [],
        },
      ],
    }));

    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      targetLocation: "local",
      workspacePath: "/workspace",
    }));

    expect(resolution.mcpServers).toEqual([]);
    expect(resolution.warnings).toEqual([
      expect.objectContaining({ kind: "needs_reconnect", catalogEntryId: "gmail" }),
    ]);
    expect(resolution.mcpBindingSummaries).toEqual([
      expect.objectContaining({ outcome: "not_applied", reason: "needs_reconnect" }),
    ]);
  });
});
