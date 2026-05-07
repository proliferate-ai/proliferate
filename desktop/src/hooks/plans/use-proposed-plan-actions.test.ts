import { describe, expect, it, vi } from "vitest";
import type { NormalizedSessionControl } from "@anyharness/sdk";
import {
  claimPlanImplementationRun,
  executePlanImplementation,
} from "@/hooks/plans/use-proposed-plan-actions";
import { PLAN_IMPLEMENT_HERE_PROMPT } from "@/copy/plans/plan-prompts";
import type { PromptPlanAttachmentDescriptor } from "@/lib/domain/chat/composer/prompt-content";
import type { StartLatencyFlowInput } from "@/lib/infra/measurement/latency-flow";

type TestSessionRecord = {
  workspaceId: string | null;
  liveConfig: {
    normalizedControls: {
      collaborationMode: NormalizedSessionControl | null;
      mode: NormalizedSessionControl | null;
    };
  } | null;
  agentKind?: string | null;
};

type TestHarnessState = {
  activeSessionId: string | null;
  sessionRecords: Record<string, TestSessionRecord | undefined>;
};

describe("executePlanImplementation", () => {
  it("toasts and does not start a flow when the source session is missing", async () => {
    const deps = depsForStates([{
      activeSessionId: "session-1",
      sessionRecords: {},
    }]);

    await executePlanImplementation({ plan: plan(), ...deps });

    expect(deps.showToast).toHaveBeenCalledWith("Plan session is not available.");
    expect(deps.startLatencyFlow).not.toHaveBeenCalled();
    expect(deps.setActiveSessionConfigOption).not.toHaveBeenCalled();
    expect(deps.promptActiveSession).not.toHaveBeenCalled();
  });

  it("toasts and does not start a flow when the source workspace is missing", async () => {
    const deps = depsForStates([state({ workspaceId: null })]);

    await executePlanImplementation({ plan: plan(), ...deps });

    expect(deps.showToast).toHaveBeenCalledWith(
      "Select a workspace before implementing a plan.",
    );
    expect(deps.startLatencyFlow).not.toHaveBeenCalled();
    expect(deps.promptActiveSession).not.toHaveBeenCalled();
  });

  it("toasts and does not start a flow when the source session is not active", async () => {
    const deps = depsForStates([state({ activeSessionId: "session-2" })]);

    await executePlanImplementation({ plan: plan(), ...deps });

    expect(deps.showToast).toHaveBeenCalledWith(
      "Select the plan's session before carrying it out.",
    );
    expect(deps.startLatencyFlow).not.toHaveBeenCalled();
    expect(deps.promptActiveSession).not.toHaveBeenCalled();
  });

  it("toasts and does not start a flow when chat availability is disabled", async () => {
    const deps = depsForStates([state()], {
      isChatDisabled: true,
      chatDisabledReason: "Review automation is running.",
    });

    await executePlanImplementation({ plan: plan(), ...deps });

    expect(deps.showToast).toHaveBeenCalledWith("Review automation is running.");
    expect(deps.startLatencyFlow).not.toHaveBeenCalled();
    expect(deps.setActiveSessionConfigOption).not.toHaveBeenCalled();
    expect(deps.promptActiveSession).not.toHaveBeenCalled();
  });

  it("submits immediately when no mode switch is needed", async () => {
    const deps = depsForStates([state()]);

    await executePlanImplementation({ plan: plan(), ...deps });

    expect(deps.setActiveSessionConfigOption).not.toHaveBeenCalled();
    expect(deps.promptActiveSession).toHaveBeenCalledTimes(1);
  });

  it("runs post-submit side effects after a successful prompt", async () => {
    const deps = depsForStates([state()]);

    await executePlanImplementation({ plan: plan(), ...deps });

    expect(deps.onPromptSubmitted).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      agentKind: "codex",
      reuseSession: true,
    });
  });

  it("applies a mode switch before submitting the prompt", async () => {
    const calls: string[] = [];
    const deps = depsForStates([state({ collaborationMode: planModeControl() })], {
      setActiveSessionConfigOption: vi.fn(async () => {
        calls.push("config");
        return { applyState: "applied" };
      }),
      promptActiveSession: vi.fn(async () => {
        calls.push("prompt");
      }),
    });

    await executePlanImplementation({ plan: plan(), ...deps });

    expect(calls).toEqual(["config", "prompt"]);
    expect(deps.setActiveSessionConfigOption).toHaveBeenCalledWith(
      "collaboration_mode",
      "default",
      { persistDefaultPreference: false },
    );
  });

  it("submits after a queued mode switch", async () => {
    const deps = depsForStates([state({ collaborationMode: planModeControl() })], {
      setActiveSessionConfigOption: vi.fn(async () => ({ applyState: "queued" })),
    });

    await executePlanImplementation({ plan: plan(), ...deps });

    expect(deps.setActiveSessionConfigOption).toHaveBeenCalledTimes(1);
    expect(deps.promptActiveSession).toHaveBeenCalledTimes(1);
  });

  it("fails the latency flow when the config switch fails", async () => {
    const deps = depsForStates([state({ collaborationMode: planModeControl() })], {
      setActiveSessionConfigOption: vi.fn(async () => {
        throw new Error("config failed");
      }),
    });

    await executePlanImplementation({ plan: plan(), ...deps });

    expect(deps.failLatencyFlow).toHaveBeenCalledWith(
      "flow-1",
      "plan_implementation_config_failed",
    );
    expect(deps.promptActiveSession).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith("Failed to carry out plan: config failed");
  });

  it("fails the latency flow when the active target changes after config", async () => {
    const deps = depsForStates([
      state({ collaborationMode: planModeControl() }),
      state({ activeSessionId: "session-2", collaborationMode: planModeControl() }),
    ]);

    await executePlanImplementation({ plan: plan(), ...deps });

    expect(deps.failLatencyFlow).toHaveBeenCalledWith(
      "flow-1",
      "plan_implementation_target_changed",
    );
    expect(deps.promptActiveSession).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith(
      "Select the plan's session before carrying it out.",
    );
  });

  it("fails the latency flow when prompt submission fails", async () => {
    const deps = depsForStates([state()], {
      promptActiveSession: vi.fn(async () => {
        throw new Error("prompt failed");
      }),
    });

    await executePlanImplementation({ plan: plan(), ...deps });

    expect(deps.failLatencyFlow).toHaveBeenCalledWith(
      "flow-1",
      "plan_implementation_prompt_failed",
    );
    expect(deps.showToast).toHaveBeenCalledWith("Failed to carry out plan: prompt failed");
  });

  it("passes the prompt id, latency flow, blocks, and optimistic content to submit", async () => {
    const deps = depsForStates([state()]);

    await executePlanImplementation({ plan: plan(), ...deps });

    const flowInput = deps.startLatencyFlow.mock.calls[0]?.[0];
    expect(flowInput).toEqual(expect.objectContaining({
      flowKind: "prompt_submit",
      source: "plan_card_implement_here",
      targetSessionId: "session-1",
      targetWorkspaceId: "workspace-1",
      promptId: expect.stringMatching(/^prompt:\d+:/),
    }));
    expect(deps.promptActiveSession).toHaveBeenCalledWith(
      PLAN_IMPLEMENT_HERE_PROMPT,
      expect.objectContaining({
        latencyFlowId: "flow-1",
        promptId: flowInput?.promptId,
        blocks: [
          { type: "text", text: PLAN_IMPLEMENT_HERE_PROMPT },
          { type: "plan_reference", planId: "plan-1", snapshotHash: "hash-1" },
        ],
        optimisticContentParts: expect.arrayContaining([
          { type: "text", text: PLAN_IMPLEMENT_HERE_PROMPT },
          expect.objectContaining({
            type: "plan_reference",
            planId: "plan-1",
            snapshotHash: "hash-1",
          }),
        ]),
      }),
    );
  });
});

describe("claimPlanImplementationRun", () => {
  it("guards a second invocation while implementation is in flight", () => {
    const ref = { current: false };

    expect(claimPlanImplementationRun(ref)).toBe(true);
    expect(claimPlanImplementationRun(ref)).toBe(false);
    ref.current = false;
    expect(claimPlanImplementationRun(ref)).toBe(true);
  });
});

function depsForStates(
  states: TestHarnessState[],
  overrides: Partial<{
    setActiveSessionConfigOption: ReturnType<typeof vi.fn>;
    promptActiveSession: ReturnType<typeof vi.fn>;
    isChatDisabled: boolean;
    chatDisabledReason: string | null;
  }> = {},
) {
  let stateReadIndex = 0;
  const getHarnessState = vi.fn(() => {
    const nextState = states[Math.min(stateReadIndex, states.length - 1)];
    stateReadIndex += 1;
    return nextState;
  });
  return {
    getHarnessState,
    setActiveSessionConfigOption:
      overrides.setActiveSessionConfigOption
      ?? vi.fn(async () => ({ applyState: "applied" })),
    promptActiveSession:
      overrides.promptActiveSession
      ?? vi.fn(async () => undefined),
    startLatencyFlow: vi.fn((_input: StartLatencyFlowInput) => "flow-1"),
    failLatencyFlow: vi.fn(),
    isChatDisabled: overrides.isChatDisabled ?? false,
    chatDisabledReason: overrides.chatDisabledReason ?? null,
    onPromptSubmitted: vi.fn(),
    showToast: vi.fn(),
  };
}

function state(input: {
  activeSessionId?: string;
  workspaceId?: string | null;
  collaborationMode?: NormalizedSessionControl | null;
  mode?: NormalizedSessionControl | null;
} = {}): TestHarnessState {
  return {
    activeSessionId: input.activeSessionId ?? "session-1",
    sessionRecords: {
      "session-1": {
        workspaceId: input.workspaceId === undefined ? "workspace-1" : input.workspaceId,
        agentKind: "codex",
        liveConfig: {
          normalizedControls: {
            collaborationMode: input.collaborationMode ?? null,
            mode: input.mode ?? null,
          },
        },
      },
    },
  };
}

function plan(): PromptPlanAttachmentDescriptor {
  return {
    id: "plan-1:hash-1",
    kind: "plan_reference",
    planId: "plan-1",
    title: "Plan title",
    bodyMarkdown: "Plan body",
    snapshotHash: "hash-1",
    sourceSessionId: "session-1",
    sourceTurnId: "turn-1",
    sourceItemId: "item-1",
    sourceKind: "proposed_plan",
    sourceToolCallId: null,
  };
}

function planModeControl(): NormalizedSessionControl {
  return {
    key: "collaboration_mode",
    rawConfigId: "collaboration_mode",
    label: "Collaboration mode",
    currentValue: "plan",
    settable: true,
    values: [
      { value: "default", label: "Default", description: null },
      { value: "plan", label: "Plan", description: null },
    ],
  };
}
