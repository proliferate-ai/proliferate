import { describe, expect, it } from "vitest";
import type { GitChangedFile, GitStatusSnapshot } from "@anyharness/sdk";
import {
  buildPublishViewState,
  defaultPublishPullRequestDraft,
  type PublishIntent,
} from "./publish-workflow";

function file(path: string, includedState: GitChangedFile["includedState"]): GitChangedFile {
  return {
    path,
    oldPath: undefined,
    status: "modified",
    additions: 1,
    deletions: 1,
    binary: false,
    includedState,
  };
}

function status(overrides: Partial<GitStatusSnapshot> = {}): GitStatusSnapshot {
  return {
    workspaceId: "workspace-1",
    workspacePath: "/repo",
    repoRootPath: "/repo",
    currentBranch: "feature/demo",
    headOid: "abc",
    detached: false,
    upstreamBranch: "origin/feature/demo",
    suggestedBaseBranch: "main",
    ahead: 0,
    behind: 0,
    operation: "none",
    conflicted: false,
    clean: false,
    summary: {
      changedFiles: 1,
      additions: 1,
      deletions: 1,
      includedFiles: 1,
      conflictedFiles: 0,
    },
    actions: {
      canCommit: true,
      canPush: false,
      pushLabel: "Push",
      canCreatePullRequest: false,
      canCreateDraftPullRequest: false,
      canCreateBranchWorkspace: true,
      reasonIfBlocked: undefined,
    },
    files: [file("src/app.ts", "included")],
    ...overrides,
  };
}

function view(overrides: {
  gitStatus?: GitStatusSnapshot | null;
  intent?: PublishIntent;
  summary?: string;
  includeUnstaged?: boolean;
  prTitle?: string;
  repoDefaultBranch?: string | null;
  existingPr?: Parameters<typeof buildPublishViewState>[0]["existingPr"];
  runtimeBlockedReason?: string | null;
} = {}) {
  const gitStatus = "gitStatus" in overrides ? overrides.gitStatus : status();
  return buildPublishViewState({
    gitStatus,
    existingPr: overrides.existingPr ?? null,
    runtimeBlockedReason: overrides.runtimeBlockedReason ?? null,
    repoDefaultBranch: overrides.repoDefaultBranch ?? null,
    initialIntent: overrides.intent ?? "commit",
    commitDraft: {
      summary: overrides.summary ?? "Update app",
      includeUnstaged: overrides.includeUnstaged ?? false,
    },
    pullRequestDraft: {
      ...defaultPublishPullRequestDraft({ gitStatus, repoDefaultBranch: overrides.repoDefaultBranch ?? null }),
      title: overrides.prTitle ?? "",
    },
  });
}

describe("buildPublishViewState", () => {
  it("commits staged-only dirty trees without staging first", () => {
    expect(view().workflowSteps).toEqual([{ kind: "commit", summary: "Update app" }]);
  });

  it("disables unstaged-only commits when includeUnstaged is off", () => {
    const result = view({
      gitStatus: status({ files: [file("src/app.ts", "excluded")] }),
      includeUnstaged: false,
    });
    expect(result.disabledReason).toBe("Stage changes or include unstaged changes before committing.");
    expect(result.workflowSteps).toEqual([]);
  });

  it("stages unstaged paths before commit when includeUnstaged is on", () => {
    const result = view({
      gitStatus: status({ files: [file("src/app.ts", "excluded")] }),
      includeUnstaged: true,
    });
    expect(result.workflowSteps).toEqual([
      { kind: "stage", paths: ["src/app.ts"] },
      { kind: "commit", summary: "Update app" },
    ]);
  });

  it("warns and stages partial paths when includeUnstaged is on", () => {
    const result = view({
      gitStatus: status({ files: [file("src/app.ts", "partial")] }),
      includeUnstaged: true,
    });
    expect(result.partialWarning).toContain("unstaged hunks");
    expect(result.workflowSteps).toEqual([
      { kind: "stage", paths: ["src/app.ts"] },
      { kind: "commit", summary: "Update app" },
    ]);
  });

  it("warns that partial-file totals may include unstaged hunks when includeUnstaged is off", () => {
    const result = view({
      gitStatus: status({ files: [file("src/app.ts", "partial")] }),
      includeUnstaged: false,
    });
    expect(result.partialWarning).toContain("only staged hunks are committed");
  });

  it("publishes clean unpublished branches with push only", () => {
    const result = view({
      intent: "publish",
      gitStatus: status({
        clean: true,
        upstreamBranch: undefined,
        ahead: 0,
        actions: { ...status().actions, canPush: true, pushLabel: "Publish branch" },
        files: [],
      }),
    });
    expect(result.primaryLabel).toBe("Publish branch");
    expect(result.publishStatus).toBe("Publish this branch and set its upstream.");
    expect(result.workflowSteps).toEqual([{ kind: "push" }]);
  });

  it("publishes clean ahead branches with push only", () => {
    const result = view({
      intent: "publish",
      gitStatus: status({
        clean: true,
        ahead: 2,
        actions: { ...status().actions, canPush: true, pushLabel: "Push" },
        files: [],
      }),
    });
    expect(result.publishStatus).toBe("Push 2 local commits to origin/feature/demo.");
    expect(result.workflowSteps).toEqual([{ kind: "push" }]);
  });

  it("disables behind or diverged branches", () => {
    expect(view({ intent: "publish", gitStatus: status({ behind: 1 }) }).disabledReason)
      .toBe("Sync this branch before publishing.");
  });

  it("allows commit-only flows on branches behind remote", () => {
    const result = view({ intent: "commit", gitStatus: status({ behind: 1 }) });
    expect(result.disabledReason).toBeNull();
    expect(result.workflowSteps).toEqual([{ kind: "commit", summary: "Update app" }]);
  });

  it("disables detached, conflicted, and runtime-blocked states", () => {
    expect(view({ gitStatus: status({ detached: true, currentBranch: undefined }) }).disabledReason)
      .toBe("Switch to a branch before publishing.");
    expect(view({ gitStatus: status({ conflicted: true }) }).disabledReason)
      .toBe("Resolve conflicts before publishing.");
    expect(view({ runtimeBlockedReason: "Workspace is starting." }).disabledReason)
      .toBe("Workspace is starting.");
  });

  it("uses PR base fallback and creates PR after publish", () => {
    const result = view({
      intent: "pull_request",
      prTitle: "Update app",
      gitStatus: status({ suggestedBaseBranch: undefined }),
      repoDefaultBranch: "develop",
    });
    expect(result.defaultBaseBranch).toBe("develop");
    expect(result.workflowSteps[result.workflowSteps.length - 1]).toEqual({
      kind: "create_pull_request",
      request: {
        title: "Update app",
        body: undefined,
        baseBranch: "develop",
        draft: false,
      },
    });
  });

  it("creates PR without pushing when a clean branch is already published", () => {
    const result = view({
      intent: "pull_request",
      prTitle: "Update app",
      gitStatus: status({
        clean: true,
        files: [],
        actions: {
          ...status().actions,
          canPush: false,
          canCreatePullRequest: true,
        },
      }),
    });
    expect(result.disabledReason).toBeNull();
    expect(result.primaryLabel).toBe("Create PR");
    expect(result.workflowSteps).toEqual([
      {
        kind: "create_pull_request",
        request: {
          title: "Update app",
          body: undefined,
          baseBranch: "main",
          draft: false,
        },
      },
    ]);
  });

  it("blocks PR creation when the head branch matches the base branch", () => {
    const result = view({
      intent: "pull_request",
      prTitle: "Update app",
      gitStatus: status({
        currentBranch: "main",
        clean: true,
        files: [],
        actions: {
          ...status().actions,
          canPush: false,
          canCreatePullRequest: false,
        },
      }),
    });
    expect(result.disabledReason).toBe("Switch to a branch other than main before creating a PR.");
    expect(result.workflowSteps).toEqual([]);
  });

  it("blocks PR creation from refs when the normalized head branch matches the base branch", () => {
    const result = view({
      intent: "pull_request",
      prTitle: "Update app",
      gitStatus: status({
        currentBranch: "refs/heads/main",
        clean: true,
        files: [],
        actions: {
          ...status().actions,
          canPush: false,
          canCreatePullRequest: true,
        },
      }),
    });
    expect(result.disabledReason).toBe("Switch to a branch other than main before creating a PR.");
    expect(result.workflowSteps).toEqual([]);
  });

  it("shows existing PR as view behavior only when there is no workflow to run", () => {
    const result = view({
      intent: "pull_request",
      gitStatus: status({
        clean: true,
        files: [],
        actions: {
          ...status().actions,
          canPush: false,
          canCreatePullRequest: true,
        },
      }),
      existingPr: {
        title: "Existing",
        url: "https://github.test/pr/1",
        state: "open",
        number: 1,
        headBranch: "feature/demo",
        baseBranch: "main",
        draft: false,
      },
    });
    expect(result.primaryLabel).toBe("View pull request");
    expect(result.workflowSteps).toEqual([]);
  });

  it("keeps existing PR view behavior secondary when dirty changes need publishing", () => {
    const result = view({
      intent: "pull_request",
      existingPr: {
        title: "Existing",
        url: "https://github.test/pr/1",
        state: "open",
        number: 1,
        headBranch: "feature/demo",
        baseBranch: "main",
        draft: false,
      },
    });
    expect(result.primaryLabel).toBe("Commit and push");
    expect(result.workflowSteps).toEqual([
      { kind: "commit", summary: "Update app" },
      { kind: "push" },
    ]);
    expect(result.workflowSteps.some((step) => step.kind === "create_pull_request")).toBe(false);
  });
});
