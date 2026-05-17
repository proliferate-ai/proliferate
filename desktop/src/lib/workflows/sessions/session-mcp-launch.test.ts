import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refreshRuntimeConfigForLaunchMock: vi.fn(),
}));

vi.mock("@/lib/workflows/mcp/runtime-config-refresh", () => ({
  refreshRuntimeConfigForLaunch: mocks.refreshRuntimeConfigForLaunchMock,
}));

import {
  COWORK_WORKSPACE_PATH_PLACEHOLDER,
  resolveSessionMcpServersForLaunch,
} from "@/lib/workflows/sessions/session-mcp-launch";

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

describe("runtime config launch resolution", () => {
  beforeEach(() => {
    mocks.refreshRuntimeConfigForLaunchMock.mockReset();
    mocks.refreshRuntimeConfigForLaunchMock.mockResolvedValue({ warnings: [] });
  });

  it("refreshes target runtime config instead of returning concrete launch MCP", async () => {
    const connection = {
      runtimeUrl: "http://runtime.local",
      anyharnessWorkspaceId: "runtime-workspace-1",
    };
    mocks.refreshRuntimeConfigForLaunchMock.mockResolvedValue({
      warnings: [
        {
          kind: "resolver_error",
          catalogEntryId: "context7",
          connectorName: "Context7",
        },
      ],
    });

    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      connection,
      targetLocation: "cloud",
      workspacePath: "/workspace",
    }));

    expect(mocks.refreshRuntimeConfigForLaunchMock).toHaveBeenCalledWith({
      connection,
      targetLocation: "cloud",
      workspacePath: "/workspace",
    });
    expect(resolution.mcpServers).toEqual([]);
    expect(resolution.mcpBindingSummaries).toEqual([]);
    expect(resolution.pluginBundle).toBeUndefined();
    expect(resolution.warnings).toEqual([
      expect.objectContaining({ kind: "resolver_error", catalogEntryId: "context7" }),
    ]);
  });

  it("does not refresh runtime config when launch policy is disabled", async () => {
    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      targetLocation: "local",
      workspacePath: "/workspace",
      policy: {
        enabled: false,
        includePolicyDisabledSummaries: true,
      },
    }));

    expect(mocks.refreshRuntimeConfigForLaunchMock).not.toHaveBeenCalled();
    expect(resolution.mcpServers).toEqual([]);
    expect(resolution.mcpBindingSummaries).toEqual([]);
    expect(resolution.pluginBundle).toBeUndefined();
    expect(resolution.warnings).toEqual([]);
    expect(resolution.releaseRuntimeReservations).toEqual(expect.any(Function));
  });

  it("does not emit a legacy empty plugin bundle on disabled resume", async () => {
    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      targetLocation: "local",
      workspacePath: "/workspace",
      policy: {
        lifecycle: "resume",
        enabled: false,
      },
    }));

    expect(mocks.refreshRuntimeConfigForLaunchMock).not.toHaveBeenCalled();
    expect(resolution.pluginBundle).toBeUndefined();
  });

  it("preserves cowork placeholder as a runtime-config workspacePath template input", async () => {
    const connection = {
      runtimeUrl: "http://runtime.local",
      anyharnessWorkspaceId: "runtime-workspace-1",
    };

    await resolveSessionMcpServersForLaunch(launchContext({
      connection,
      targetLocation: "local",
      workspacePath: COWORK_WORKSPACE_PATH_PLACEHOLDER,
      policy: {
        workspaceSurface: "cowork",
      },
    }));

    expect(mocks.refreshRuntimeConfigForLaunchMock).toHaveBeenCalledWith({
      connection,
      targetLocation: "local",
      workspacePath: COWORK_WORKSPACE_PATH_PLACEHOLDER,
    });
  });

  it("returns empty concrete MCP when no runtime connection is available", async () => {
    const resolution = await resolveSessionMcpServersForLaunch(launchContext({
      targetLocation: "local",
      workspacePath: "/workspace",
    }));

    expect(mocks.refreshRuntimeConfigForLaunchMock).not.toHaveBeenCalled();
    expect(resolution.mcpServers).toEqual([]);
    expect(resolution.mcpBindingSummaries).toEqual([]);
    expect(resolution.pluginBundle).toBeUndefined();
  });
});
