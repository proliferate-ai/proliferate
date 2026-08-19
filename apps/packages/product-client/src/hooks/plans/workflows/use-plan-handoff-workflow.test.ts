import { describe, expect, it, vi } from "vitest";
import { executePlanHandoff } from "#product/hooks/plans/workflows/use-plan-handoff-workflow";

describe("executePlanHandoff", () => {
  it("creates with the complete target-observed control map before prompting", async () => {
    const calls: string[] = [];
    const promptSession = vi.fn(async () => {
      calls.push("prompt");
    });

    await executePlanHandoff({
      launchSelection: { kind: "codex", modelId: "gpt-5.4" },
      selectedWorkspaceId: "workspace-1",
      launchControlValues: { access: "full-access", collaboration: "default" },
      text: "Use the attached plan and continue the work.",
      blocks: [{ type: "plan_reference", planId: "plan-1", snapshotHash: "hash-1" }],
      optimisticContentParts: [],
      previousActiveSessionId: "session-old",
      createEmptySessionWithResolvedConfig: vi.fn(async () => {
        calls.push("create");
        return "session-new";
      }),
      promptSession,
      dismissSession: vi.fn(),
      selectSession: vi.fn(),
      hasSession: () => true,
      onCompleted: () => {
        calls.push("completed");
      },
      showErrorToast: vi.fn(),
      retry: vi.fn(),
    });

    expect(calls).toEqual(["create", "prompt", "completed"]);
    expect(promptSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-new",
      workspaceId: "workspace-1",
    }));
  });

  it("dismisses the half-created session and restores the previous session when prompting fails", async () => {
    const calls: string[] = [];
    const dismissSession = vi.fn(async (sessionId: string) => {
      calls.push(`dismiss:${sessionId}`);
    });
    const selectSession = vi.fn(async (sessionId: string) => {
      calls.push(`select:${sessionId}`);
    });
    // Recorded into the same ordered list as the rollback steps: the
    // consequence promises the user is back where they were, which is only true
    // if the toast is raised after the dismiss and the reselect, not before.
    const showErrorToast = vi.fn((input: { headline: string }) => {
      calls.push(`toast:${input.headline}`);
    });

    await executePlanHandoff({
      launchSelection: { kind: "codex", modelId: "gpt-5.4" },
      selectedWorkspaceId: "workspace-1",
      launchControlValues: { access: "full-access", collaboration: "default" },
      text: "Use the attached plan and continue the work.",
      blocks: [{ type: "plan_reference", planId: "plan-1", snapshotHash: "hash-1" }],
      optimisticContentParts: [],
      previousActiveSessionId: "session-old",
      createEmptySessionWithResolvedConfig: vi.fn(async () => {
        calls.push("create");
        return "session-new";
      }),
      promptSession: vi.fn(async () => {
        calls.push("prompt");
        throw new Error("The prompt could not start.");
      }),
      dismissSession,
      selectSession,
      hasSession: (sessionId) => sessionId === "session-old",
      onCompleted: vi.fn(),
      showErrorToast,
      retry: vi.fn(),
    });

    expect(calls).toEqual([
      "create",
      "prompt",
      "dismiss:session-new",
      "select:session-old",
      "toast:Plan not handed off",
    ]);
    expect(showErrorToast).toHaveBeenCalledWith(expect.objectContaining({
      consequence: "No new chat was started and you are back in the session you were in.",
      cause: "The prompt could not start.",
    }));
    expect(dismissSession).toHaveBeenCalledWith("session-new");
    expect(selectSession).toHaveBeenCalledWith("session-old");
  });
});
