import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  commandExistsMock: vi.fn(async () => true),
  materializeCloudMcpServersMock: vi.fn(),
}));

vi.mock("@/platform/tauri/process", () => ({
  commandExists: mocks.commandExistsMock,
}));

vi.mock("@/lib/integrations/cloud/mcp_materialization", () => ({
  materializeCloudMcpServers: mocks.materializeCloudMcpServersMock,
}));

import {
  COWORK_WORKSPACE_PATH_PLACEHOLDER,
  resolveSessionMcpServersForLaunch,
} from "@/lib/integrations/anyharness/mcp_launch";

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
});
