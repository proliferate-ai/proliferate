import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  annotateLatencyFlow,
  finishLatencyFlow,
  getLatencyFlowRequestHeaders,
  listActiveLatencyFlows,
  markLatencyFlowLiveAttached,
  pruneLatencyFlows,
  resetLatencyFlowsForTest,
  startLatencyFlow,
} from "./latency-flow";

describe("latency-flow", () => {
  beforeEach(() => {
    resetLatencyFlowsForTest();
  });

  it("tracks prompt flows across optimistic and processing stages", () => {
    const flowId = startLatencyFlow({
      flowKind: "prompt_submit",
      source: "composer_submit",
    });

    annotateLatencyFlow(flowId, {
      targetWorkspaceId: "workspace-1",
      targetSessionId: "session-1",
      promptId: "prompt-1",
    });

    const headers = new Headers(getLatencyFlowRequestHeaders(flowId));
    expect(headers.get("x-anyharness-flow-id")).toBe(flowId);
    expect(headers.get("x-anyharness-flow-kind")).toBe("prompt_submit");
    expect(headers.get("x-anyharness-flow-source")).toBe("composer_submit");
    expect(headers.get("x-anyharness-prompt-id")).toBe("prompt-1");

    expect(finishLatencyFlow(flowId, "optimistic_visible")).toBe(true);
    expect(listActiveLatencyFlows()).toHaveLength(1);

    expect(finishLatencyFlow(flowId, "processing_started")).toBe(true);
    expect(listActiveLatencyFlows()).toHaveLength(0);
  });

  it("prunes stale flows", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    startLatencyFlow({
      flowKind: "workspace_switch",
      source: "sidebar",
      targetWorkspaceId: "workspace-1",
    });

    pruneLatencyFlows(1_000 + (5 * 60 * 1_000) + 1);
    expect(listActiveLatencyFlows()).toHaveLength(0);
  });

  it("keeps prompt flows out of live-attach completion", () => {
    const sessionFlowId = startLatencyFlow({
      flowKind: "session_switch",
      targetSessionId: "session-1",
    });
    const promptFlowId = startLatencyFlow({
      flowKind: "prompt_submit",
      targetSessionId: "session-1",
    });

    finishLatencyFlow(sessionFlowId, "surface_ready");
    markLatencyFlowLiveAttached("session-1");

    const activeFlowIds = listActiveLatencyFlows().map((flow) => flow.flowId);
    expect(activeFlowIds).toContain(promptFlowId);
    expect(activeFlowIds).not.toContain(sessionFlowId);
  });
});
