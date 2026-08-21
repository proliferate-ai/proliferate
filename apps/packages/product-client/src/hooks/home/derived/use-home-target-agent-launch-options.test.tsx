// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useHomeTargetAgentLaunchOptions,
  useHomeTargetOtherAgentsLaunchOptions,
} from "#product/hooks/home/derived/use-home-target-agent-launch-options";

const mocks = vi.hoisted(() => ({
  cloudLaunchArgs: null as Record<string, unknown> | null,
  cloudLaunchResult: {
    data: undefined as unknown,
    error: null as Error | null,
    isError: false,
    isLoading: false,
  },
  cloudSandboxEnabled: null as boolean | null,
  cloudSandboxResult: {
    data: { id: "cloud-sandbox-1" } as { id: string } | null | undefined,
    error: null as Error | null,
    isError: false,
    isLoading: false,
  },
  listArgs: null as Record<string, unknown> | null,
  listEntries: [] as unknown[],
  localArgs: null as Record<string, unknown> | null,
  localResult: {
    data: undefined as unknown,
    error: null as Error | null,
    isError: false,
    isLoading: false,
  },
}));

vi.mock("@anyharness/sdk-react", () => ({
  useAgentLaunchOptionsQuery: (args: Record<string, unknown>) => {
    mocks.localArgs = args;
    return mocks.localResult;
  },
  useAgentLaunchOptionsListQuery: (args: Record<string, unknown>) => {
    mocks.listArgs = args;
    return mocks.listEntries;
  },
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useCloudSandbox: (enabled: boolean) => {
    mocks.cloudSandboxEnabled = enabled;
    return mocks.cloudSandboxResult;
  },
  useCloudHarnessLaunchOptions: (args: Record<string, unknown>) => {
    mocks.cloudLaunchArgs = args;
    return mocks.cloudLaunchResult;
  },
}));

describe("useHomeTargetAgentLaunchOptions", () => {
  beforeEach(() => {
    mocks.cloudLaunchArgs = null;
    mocks.cloudLaunchResult = queryResult();
    mocks.cloudSandboxEnabled = null;
    mocks.cloudSandboxResult = {
      data: { id: "cloud-sandbox-1" },
      error: null,
      isError: false,
      isLoading: false,
    };
    mocks.listArgs = null;
    mocks.listEntries = [];
    mocks.localArgs = null;
    mocks.localResult = queryResult();
  });

  afterEach(cleanup);

  it("reads local-runtime options only for a local execution target", () => {
    mocks.localResult = queryResult({ data: { harnessKind: "claude", options: null } });
    const { result } = renderHook(() => useHomeTargetAgentLaunchOptions({
      harnessKind: "claude",
      launchTarget: { kind: "cowork" },
    }));

    expect(mocks.localArgs).toEqual({ harnessKind: "claude", enabled: true });
    expect(mocks.cloudSandboxEnabled).toBe(false);
    expect(mocks.cloudLaunchArgs).toEqual({
      cloudSandboxId: "cloud-sandbox-1",
      harnessKind: "claude",
      enabled: false,
    });
    expect(result.current.data).toEqual({ harnessKind: "claude", options: null });
  });

  it("reads copied options by the actual cloud sandbox id and disables local reads", () => {
    mocks.localResult = queryResult({ data: { harnessKind: "local-only", options: null } });
    mocks.cloudLaunchResult = queryResult({ data: { harnessKind: "codex", options: null } });
    const { result } = renderHook(() => useHomeTargetAgentLaunchOptions({
      harnessKind: "codex",
      launchTarget: {
        kind: "cloud",
        gitOwner: "owner",
        gitRepoName: "repo",
        baseBranch: "main",
      },
    }));

    expect(mocks.localArgs).toEqual({ harnessKind: "codex", enabled: false });
    expect(mocks.cloudSandboxEnabled).toBe(true);
    expect(mocks.cloudLaunchArgs).toEqual({
      cloudSandboxId: "cloud-sandbox-1",
      harnessKind: "codex",
      enabled: true,
    });
    expect(result.current.data).toEqual({ harnessKind: "codex", options: null });
  });

  it("reports a missing copied observation without falling back locally", () => {
    mocks.cloudLaunchResult = queryResult({
      error: Object.assign(new Error("not observed"), { status: 404 }),
      isError: true,
    });
    const { result } = renderHook(() => useHomeTargetAgentLaunchOptions({
      harnessKind: "grok",
      launchTarget: {
        kind: "cloud",
        gitOwner: "owner",
        gitRepoName: "repo",
        baseBranch: "main",
      },
    }));

    expect(mocks.localArgs).toEqual({ harnessKind: "grok", enabled: false });
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
    expect(result.current.isError).toBe(false);
    expect(result.current.isTargetUnobserved).toBe(true);
  });

  it("disables both sources until Home resolves a launch target", () => {
    const { result } = renderHook(() => useHomeTargetAgentLaunchOptions({
      harnessKind: "claude",
      launchTarget: null,
    }));

    expect(mocks.localArgs).toEqual({ harnessKind: "claude", enabled: false });
    expect(mocks.cloudSandboxEnabled).toBe(false);
    expect(mocks.cloudLaunchArgs).toMatchObject({ enabled: false });
    expect(result.current.data).toBeUndefined();
  });

  it("hands the fan-out kinds their per-kind pending and error flags", () => {
    // `data === null` reads the same for a kind still being asked and a kind
    // whose read failed; only these flags separate them, and the Home gate
    // reports them as different states.
    mocks.listEntries = [
      { harnessKind: "codex", data: null, isPending: true, isError: false },
      { harnessKind: "cursor", data: null, isPending: false, isError: true },
    ];
    const { result } = renderHook(() => useHomeTargetOtherAgentsLaunchOptions({
      harnessKinds: ["codex", "cursor"],
      launchTarget: { kind: "local", sourceRoot: "/repo", existingWorkspaceId: null },
    }));

    expect(mocks.listArgs).toEqual({ harnessKinds: ["codex", "cursor"], enabled: true });
    expect(result.current).toEqual(mocks.listEntries);
  });

  it("returns a stable empty list for a cloud target", () => {
    mocks.listEntries = [
      { harnessKind: "codex", data: null, isPending: true, isError: false },
    ];
    const { result, rerender } = renderHook(() => useHomeTargetOtherAgentsLaunchOptions({
      harnessKinds: ["codex"],
      launchTarget: { kind: "cloud", gitOwner: "owner", gitRepoName: "repo", baseBranch: "main" },
    }));
    const first = result.current;
    expect(first).toEqual([]);
    rerender();
    expect(result.current).toBe(first);
  });
});

function queryResult(overrides: Partial<{
  data: unknown;
  error: Error | null;
  isError: boolean;
  isLoading: boolean;
}> = {}) {
  return {
    data: undefined,
    error: null,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
    ...overrides,
  };
}
