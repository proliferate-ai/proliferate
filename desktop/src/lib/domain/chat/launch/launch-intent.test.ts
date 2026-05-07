import { describe, expect, it } from "vitest";
import type { ChatLaunchIntent } from "@/lib/domain/chat/launch/launch-intent";
import type { PendingWorkspaceEntry } from "@/lib/domain/workspaces/creation/pending-entry";
import {
  resolveChatLaunchIntentView,
  resolveChatLaunchRetryMode,
  resolveLaunchIntentPendingWorkspaceId,
} from "@/lib/domain/chat/launch/launch-intent";

function intent(overrides: Partial<ChatLaunchIntent> = {}): ChatLaunchIntent {
  return {
    id: "launch-1",
    promptId: "prompt-1",
    text: "Build the thing",
    contentParts: [{ type: "text", text: "Build the thing" }],
    targetKind: "cowork",
    retryInput: {
      text: "Build the thing",
      modelSelection: { kind: "codex", modelId: "gpt-5.4" },
      modeId: null,
      target: { kind: "cowork" },
    },
    materializedWorkspaceId: null,
    materializedSessionId: null,
    createdAt: 100,
    sendAttemptedAt: null,
    failure: null,
    ...overrides,
  };
}

function pendingEntry(
  overrides: Partial<PendingWorkspaceEntry> = {},
): PendingWorkspaceEntry {
  return {
    attemptId: "attempt-1",
    source: "worktree-created",
    stage: "failed",
    displayName: "worktree",
    repoLabel: null,
    baseBranchName: null,
    workspaceId: "workspace-1",
    request: { kind: "select-existing", workspaceId: "workspace-1" },
    originTarget: { kind: "home" },
    errorMessage: "failed",
    setupScript: null,
    createdAt: 100,
    ...overrides,
  };
}

describe("chat launch intent view", () => {
  it("offers retry and back before the prompt send attempt", () => {
    const view = resolveChatLaunchIntentView(intent({
      failure: {
        message: "workspace failed",
        retryMode: "safe",
        failedAt: 200,
      },
    }));

    expect(view.canRetry).toBe(true);
    expect(view.canReturnHome).toBe(true);
    expect(view.canDismiss).toBe(false);
  });

  it("does not offer retry after a prompt send attempt", () => {
    const view = resolveChatLaunchIntentView(intent({
      sendAttemptedAt: 150,
      failure: {
        message: "prompt failed",
        retryMode: "unknown_after_send",
        failedAt: 200,
      },
    }));

    expect(view.canRetry).toBe(false);
    expect(view.canReturnHome).toBe(false);
    expect(view.canDismiss).toBe(true);
  });

  it("does not offer retry after a workspace materializes", () => {
    const view = resolveChatLaunchIntentView(intent({
      materializedWorkspaceId: "workspace-1",
      failure: {
        message: "session failed",
        retryMode: "manual_after_workspace",
        failedAt: 200,
      },
    }));

    expect(view.canRetry).toBe(false);
    expect(view.canReturnHome).toBe(false);
    expect(view.canDismiss).toBe(true);
    expect(view.dismissLabel).toBe("Show workspace");
  });

  it("classifies materialized workspaces as manual retry cases", () => {
    expect(resolveChatLaunchRetryMode(intent({
      materializedWorkspaceId: "workspace-1",
    }))).toBe("manual_after_workspace");
  });

  it("classifies prompt send attempts as unknown-send retry cases", () => {
    expect(resolveChatLaunchRetryMode(intent({
      materializedWorkspaceId: "workspace-1",
      sendAttemptedAt: 150,
    }))).toBe("unknown_after_send");
  });

  it("matches pending workspace ids for launch-created workspaces", () => {
    expect(resolveLaunchIntentPendingWorkspaceId(
      intent({
        targetKind: "worktree",
        retryInput: {
          text: "Build the thing",
          modelSelection: { kind: "codex", modelId: "gpt-5.4" },
          modeId: null,
          target: {
            kind: "worktree",
            repoRootId: "repo-1",
            sourceWorkspaceId: null,
            baseBranch: "main",
          },
        },
      }),
      pendingEntry({ source: "worktree-created" }),
    )).toBe("workspace-1");
  });

  it("does not match existing-workspace local launches as materialized creations", () => {
    expect(resolveLaunchIntentPendingWorkspaceId(
      intent({
        targetKind: "local",
        retryInput: {
          text: "Build the thing",
          modelSelection: { kind: "codex", modelId: "gpt-5.4" },
          modeId: null,
          target: { kind: "local", sourceRoot: "/repo", existingWorkspaceId: "workspace-1" },
        },
      }),
      pendingEntry({ source: "local-created" }),
    )).toBeNull();
  });
});
