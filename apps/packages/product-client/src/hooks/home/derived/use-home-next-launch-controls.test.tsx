// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHomeNextLaunchControls } from "#product/hooks/home/derived/use-home-next-launch-controls";

const mocks = vi.hoisted(() => ({
  args: null as Record<string, unknown> | null,
  data: undefined as ReturnType<typeof response> | undefined,
}));

vi.mock("#product/hooks/home/derived/use-home-target-agent-launch-options", () => ({
  useHomeTargetAgentLaunchOptions: (args: Record<string, unknown>) => {
    mocks.args = args;
    return {
      data: mocks.data,
      error: null,
      isError: false,
      isLoading: false,
      isTargetUnobserved: false,
    };
  },
}));

describe("useHomeNextLaunchControls", () => {
  afterEach(cleanup);

  it("preserves both independent Codex controls and exact defaults", () => {
    mocks.data = response();
    const launchTarget = {
      kind: "cloud",
      gitOwner: "owner",
      gitRepoName: "repo",
      baseBranch: "main",
    } as const;
    const { result } = renderHook(() => useHomeNextLaunchControls({
      modelSelection: { kind: "codex", modelId: "gpt-5.6-codex" },
      launchTarget,
      controlOverrides: { mode: "agent-full-access" },
      onSelectControl: vi.fn(),
    }));
    expect(mocks.args).toEqual({ harnessKind: "codex", launchTarget });
    expect(result.current.controls.map((control) => control.key)).toEqual([
      "collaboration_mode",
      "mode",
    ]);
    expect(result.current.launchControlValues).toEqual({
      collaboration_mode: "plan",
      mode: "agent-full-access",
    });
  });

  it("does not manufacture controls without target-observed options", () => {
    mocks.data = undefined;
    const { result } = renderHook(() => useHomeNextLaunchControls({
      modelSelection: { kind: "codex", modelId: "gpt-5.6-codex" },
      launchTarget: null,
      controlOverrides: {},
      onSelectControl: vi.fn(),
    }));
    expect(result.current.controls).toEqual([]);
    expect(result.current.launchControlValues).toEqual({});
  });
});

function response() {
  return {
    harnessKind: "codex", basisRevision: "basis-1", revision: 2, state: "observed",
    options: {
      models: [{ id: "gpt-5.6-codex", observedName: "GPT-5.6 Codex", observedDescription: null }],
      controls: [
        { id: "collaboration_mode", observedLabel: "Mode", observedDescription: null, values: [
          { value: "default", observedLabel: "Default", observedDescription: null },
          { value: "plan", observedLabel: "Plan", observedDescription: null },
        ] },
        { id: "mode", observedLabel: "Access", observedDescription: null, values: [
          { value: "read-only", observedLabel: "Read only", observedDescription: null },
          { value: "agent", observedLabel: "Agent", observedDescription: null },
          { value: "agent-full-access", observedLabel: "Full access", observedDescription: null },
        ] },
      ],
      defaults: { modelId: "gpt-5.6-codex", controlValues: {
        collaboration_mode: "plan", mode: "agent-full-access",
      } },
    },
    observedAt: null, probeAttemptedAt: null, probeFailureCode: null, readiness: "ready",
  };
}
