// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHomeNextLaunchControls } from "#product/hooks/home/derived/use-home-next-launch-controls";

vi.mock("@anyharness/sdk-react", () => ({
  useAgentLaunchOptionsQuery: () => ({ data: response(), isLoading: false }),
}));

describe("useHomeNextLaunchControls", () => {
  afterEach(cleanup);

  it("preserves both independent Codex controls and exact defaults", () => {
    const { result } = renderHook(() => useHomeNextLaunchControls({
      modelSelection: { kind: "codex", modelId: "gpt-5.6-codex" },
      controlOverrides: { mode: "agent-full-access" },
      onSelectControl: vi.fn(),
    }));
    expect(result.current.controls.map((control) => control.key)).toEqual([
      "collaboration_mode",
      "mode",
    ]);
    expect(result.current.launchControlValues).toEqual({
      collaboration_mode: "plan",
      mode: "agent-full-access",
    });
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
