import { describe, expect, it } from "vitest";
import type { LatencyFlowRecord } from "@/lib/infra/latency-flow";
import { collectTelemetryLatencyFlowCompletions } from "./use-telemetry-latency-flows";

function createFlow(overrides: Partial<LatencyFlowRecord>): LatencyFlowRecord {
  return {
    flowId: overrides.flowId ?? "flow-1",
    flowKind: overrides.flowKind ?? "prompt_submit",
    startedAt: overrides.startedAt ?? Date.now(),
    source: overrides.source ?? null,
    targetWorkspaceId: overrides.targetWorkspaceId ?? null,
    targetSessionId: overrides.targetSessionId ?? null,
    attemptId: overrides.attemptId ?? null,
    promptId: overrides.promptId ?? null,
    completedStages: overrides.completedStages ?? new Set(["intent"]),
  };
}

describe("collectTelemetryLatencyFlowCompletions", () => {
  it("marks prompt flows optimistic when the pending prompt is visible", () => {
    const completions = collectTelemetryLatencyFlowCompletions({
      activeFlows: [
        createFlow({
          flowId: "flow-prompt",
          flowKind: "prompt_submit",
          targetSessionId: "session-1",
          promptId: "prompt-1",
        }),
      ],
      selectedWorkspaceId: "workspace-1",
      activeSessionId: "session-1",
      pendingUserPrompt: {
        text: "hello",
        timestamp: "2026-04-07T00:00:00.000Z",
        flowId: "flow-prompt",
        promptId: "prompt-1",
      },
      sessionViewState: "sending",
      modeKind: "session-transcript",
    });

    expect(completions).toEqual([
      { flowId: "flow-prompt", stage: "optimistic_visible" },
    ]);
  });

  it("marks prompt flows processing_started only after the pending prompt clears", () => {
    const completions = collectTelemetryLatencyFlowCompletions({
      activeFlows: [
        createFlow({
          flowId: "flow-prompt",
          flowKind: "prompt_submit",
          targetSessionId: "session-1",
        }),
      ],
      selectedWorkspaceId: "workspace-1",
      activeSessionId: "session-1",
      pendingUserPrompt: null,
      sessionViewState: "working",
      modeKind: "session-transcript",
    });

    expect(completions).toEqual([
      { flowId: "flow-prompt", stage: "processing_started" },
    ]);
  });

  it("waits for the loading surface to clear before finishing session flows", () => {
    const sessionFlow = createFlow({
      flowId: "flow-session",
      flowKind: "session_switch",
      targetSessionId: "session-1",
    });

    expect(collectTelemetryLatencyFlowCompletions({
      activeFlows: [sessionFlow],
      selectedWorkspaceId: "workspace-1",
      activeSessionId: "session-1",
      pendingUserPrompt: null,
      sessionViewState: "idle",
      modeKind: "session-loading",
    })).toEqual([]);

    expect(collectTelemetryLatencyFlowCompletions({
      activeFlows: [sessionFlow],
      selectedWorkspaceId: "workspace-1",
      activeSessionId: "session-1",
      pendingUserPrompt: null,
      sessionViewState: "idle",
      modeKind: "session-empty",
    })).toEqual([
      { flowId: "flow-session", stage: "surface_ready" },
    ]);
  });

  it("finishes restore flows once the restored session surface is ready", () => {
    const completions = collectTelemetryLatencyFlowCompletions({
      activeFlows: [
        createFlow({
          flowId: "flow-session-restore",
          flowKind: "session_restore",
          targetSessionId: "session-1",
        }),
      ],
      selectedWorkspaceId: "workspace-1",
      activeSessionId: "session-1",
      pendingUserPrompt: null,
      sessionViewState: "idle",
      modeKind: "session-empty",
    });

    expect(completions).toEqual([
      { flowId: "flow-session-restore", stage: "surface_ready" },
    ]);
  });

  it("does not finish a session flow before a real target session exists", () => {
    const completions = collectTelemetryLatencyFlowCompletions({
      activeFlows: [
        createFlow({
          flowId: "flow-session-create",
          flowKind: "session_create",
          targetSessionId: null,
        }),
      ],
      selectedWorkspaceId: "workspace-1",
      activeSessionId: null,
      pendingUserPrompt: null,
      sessionViewState: "idle",
      modeKind: "session-empty",
    });

    expect(completions).toEqual([]);
  });

  it("treats workspace status screens as surface ready for workspace flows", () => {
    const completions = collectTelemetryLatencyFlowCompletions({
      activeFlows: [
        createFlow({
          flowId: "flow-workspace",
          flowKind: "workspace_switch",
          targetWorkspaceId: "workspace-1",
        }),
      ],
      selectedWorkspaceId: "workspace-1",
      activeSessionId: null,
      pendingUserPrompt: null,
      sessionViewState: "idle",
      modeKind: "workspace-status",
    });

    expect(completions).toEqual([
      { flowId: "flow-workspace", stage: "surface_ready" },
    ]);
  });
});
