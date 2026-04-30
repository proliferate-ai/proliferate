import { describe, expect, it, vi } from "vitest";
import { executePlanHandoff } from "@/hooks/plans/use-plan-handoff-workflow";

describe("executePlanHandoff", () => {
  it("applies pre-prompt config changes before sending the first prompt", async () => {
    const calls: string[] = [];
    const promptSession = vi.fn(async () => {
      calls.push("prompt");
    });

    await executePlanHandoff({
      launchSelection: { kind: "codex", modelId: "gpt-5.4" },
      selectedWorkspaceId: "workspace-1",
      selectedModeId: "full-access",
      text: "Use the attached plan and continue the work.",
      blocks: [{ type: "plan_reference", planId: "plan-1", snapshotHash: "hash-1" }],
      optimisticContentParts: [],
      previousActiveSessionId: "session-old",
      createEmptySessionWithResolvedConfig: vi.fn(async () => {
        calls.push("create");
        return "session-new";
      }),
      applyPrePromptConfigChanges: vi.fn(async () => {
        calls.push("apply-config");
      }),
      promptSession,
      dismissSession: vi.fn(),
      selectSession: vi.fn(),
      hasSession: () => true,
      onCompleted: () => {
        calls.push("completed");
      },
      showToast: vi.fn(),
    });

    expect(calls).toEqual(["create", "apply-config", "prompt", "completed"]);
    expect(promptSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-new",
      workspaceId: "workspace-1",
    }));
  });

  it("dismisses the half-created session and restores the previous session when override fails", async () => {
    const calls: string[] = [];
    const dismissSession = vi.fn(async (sessionId: string) => {
      calls.push(`dismiss:${sessionId}`);
    });
    const selectSession = vi.fn(async (sessionId: string) => {
      calls.push(`select:${sessionId}`);
    });
    const showToast = vi.fn((message: string) => {
      calls.push(`toast:${message}`);
    });

    await executePlanHandoff({
      launchSelection: { kind: "codex", modelId: "gpt-5.4" },
      selectedWorkspaceId: "workspace-1",
      selectedModeId: "full-access",
      text: "Use the attached plan and continue the work.",
      blocks: [{ type: "plan_reference", planId: "plan-1", snapshotHash: "hash-1" }],
      optimisticContentParts: [],
      previousActiveSessionId: "session-old",
      createEmptySessionWithResolvedConfig: vi.fn(async () => {
        calls.push("create");
        return "session-new";
      }),
      applyPrePromptConfigChanges: vi.fn(async () => {
        calls.push("apply-config");
        throw new Error("The session could not leave plan mode before the first prompt.");
      }),
      promptSession: vi.fn(async () => {
        calls.push("prompt");
      }),
      dismissSession,
      selectSession,
      hasSession: (sessionId) => sessionId === "session-old",
      onCompleted: vi.fn(),
      showToast,
    });

    expect(calls).toEqual([
      "create",
      "apply-config",
      "dismiss:session-new",
      "select:session-old",
      "toast:Failed to hand off plan: The session could not leave plan mode before the first prompt.",
    ]);
    expect(dismissSession).toHaveBeenCalledWith("session-new");
    expect(selectSession).toHaveBeenCalledWith("session-old");
  });
});
