import { describe, expect, it } from "vitest";
import type { ChatLaunchIntent } from "#product/lib/domain/chat/launch/launch-intent";
import type { PendingWorkspaceEntry } from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  launchIntentOwnsShell,
  resolveChatLaunchIntentView,
  resolveChatLaunchRetryMode,
  resolveLaunchIntentPendingAttemptId,
  resolveLaunchIntentPendingWorkspaceId,
  resolveLaunchIntentScope,
} from "#product/lib/domain/chat/launch/launch-intent";

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
    attemptId: null,
    targetWorkspaceId: null,
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
            defaultBranch: "main",
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

  it("matches the pending attempt id before a workspace id resolves", () => {
    expect(resolveLaunchIntentPendingAttemptId(
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
            defaultBranch: "main",
          },
        },
      }),
      pendingEntry({ source: "worktree-created", workspaceId: null, attemptId: "attempt-2" }),
    )).toBe("attempt-2");
  });

  it("does not match an unrelated pending entry's attempt id", () => {
    expect(resolveLaunchIntentPendingAttemptId(
      intent({ targetKind: "cowork" }),
      pendingEntry({ source: "worktree-created", attemptId: "attempt-2" }),
    )).toBeNull();
  });
});

describe("resolveLaunchIntentScope", () => {
  it("has no scope before an attempt or workspace is known", () => {
    expect(resolveLaunchIntentScope(intent())).toEqual({
      pendingUiKey: null,
      workspaceId: null,
    });
  });

  it("scopes to the pending-workspace UI key once an attempt id is known", () => {
    expect(resolveLaunchIntentScope(intent({ attemptId: "attempt-1" }))).toEqual({
      pendingUiKey: "pending-workspace:attempt-1",
      workspaceId: null,
    });
  });

  it("scopes to the target workspace id for launches into an existing workspace", () => {
    expect(resolveLaunchIntentScope(intent({ targetWorkspaceId: "workspace-1" }))).toEqual({
      pendingUiKey: null,
      workspaceId: "workspace-1",
    });
  });

  it("prefers the materialized workspace id over the target once it resolves", () => {
    expect(resolveLaunchIntentScope(intent({
      targetWorkspaceId: "workspace-target",
      materializedWorkspaceId: "workspace-real",
    }))).toEqual({
      pendingUiKey: null,
      workspaceId: "workspace-real",
    });
  });
});

describe("launchIntentOwnsShell", () => {
  it("owns an empty shell when unscoped", () => {
    expect(launchIntentOwnsShell({
      scope: null,
      shellLogicalWorkspaceId: null,
      shellWorkspaceId: null,
    })).toBe(true);
  });

  it("does not own a selected shell when unscoped", () => {
    expect(launchIntentOwnsShell({
      scope: null,
      shellLogicalWorkspaceId: "workspace-1",
      shellWorkspaceId: "workspace-1",
    })).toBe(false);
  });

  it("owns the shell matching its pending UI key", () => {
    expect(launchIntentOwnsShell({
      scope: { pendingUiKey: "pending-workspace:attempt-1", workspaceId: null },
      shellLogicalWorkspaceId: "pending-workspace:attempt-1",
      shellWorkspaceId: null,
    })).toBe(true);
  });

  it("does not own an unrelated shell when scoped", () => {
    expect(launchIntentOwnsShell({
      scope: { pendingUiKey: null, workspaceId: "workspace-a" },
      shellLogicalWorkspaceId: "workspace-b",
      shellWorkspaceId: "workspace-b",
    })).toBe(false);
  });

  it("owns the shell matching its materialized/target workspace id", () => {
    expect(launchIntentOwnsShell({
      scope: { pendingUiKey: null, workspaceId: "workspace-a" },
      shellLogicalWorkspaceId: "workspace-a",
      shellWorkspaceId: "workspace-a",
    })).toBe(true);
  });
});
