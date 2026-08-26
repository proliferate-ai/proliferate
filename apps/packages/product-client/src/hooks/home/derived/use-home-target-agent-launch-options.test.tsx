// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useHomeTargetAgentLaunchOptions,
  useHomeTargetOtherAgentsLaunchOptions,
} from "#product/hooks/home/derived/use-home-target-agent-launch-options";

const mocks = vi.hoisted(() => ({
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

describe("useHomeTargetAgentLaunchOptions", () => {
  beforeEach(() => {
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
    expect(result.current.data).toEqual({ harnessKind: "claude", options: null });
  });

  it("treats a cloud target as permanently unobserved and disables local reads", () => {
    mocks.localResult = queryResult({ data: { harnessKind: "local-only", options: null } });
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
    expect(result.current.data).toBeUndefined();
    expect(result.current.isTargetUnobserved).toBe(true);
  });

  it("reports a missing copied observation without falling back locally", () => {
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
