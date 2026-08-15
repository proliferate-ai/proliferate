import { describe, expect, it } from "vitest";
import {
  presentWorkspaceCreationReceipt,
  resolveFirstWorkspaceSessionId,
  workspaceCreationReceiptCopyText,
  type WorkspaceCreationReceiptSetupSource,
  type WorkspaceCreationReceiptSource,
} from "./creation-receipt";

describe("resolveFirstWorkspaceSessionId", () => {
  it("returns null for missing or empty session lists", () => {
    expect(resolveFirstWorkspaceSessionId(undefined)).toBeNull();
    expect(resolveFirstWorkspaceSessionId([])).toBeNull();
  });

  it("picks the earliest createdAt regardless of list order", () => {
    expect(resolveFirstWorkspaceSessionId([
      { id: "session-b", createdAt: "2026-01-02T00:00:00.000Z" },
      { id: "session-a", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "session-c", createdAt: "2026-01-03T00:00:00.000Z" },
    ])).toBe("session-a");
  });

  it("breaks createdAt ties toward the smaller id for stability", () => {
    expect(resolveFirstWorkspaceSessionId([
      { id: "session-b", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "session-a", createdAt: "2026-01-01T00:00:00.000Z" },
    ])).toBe("session-a");
  });
});

function setupSource(
  overrides: Partial<WorkspaceCreationReceiptSetupSource> = {},
): WorkspaceCreationReceiptSetupSource {
  return {
    command: "pnpm install",
    status: null,
    failureSummary: null,
    terminalId: null,
    ...overrides,
  };
}

describe("presentWorkspaceCreationReceipt", () => {
  it("creating: shows the busy line, a spinner, and the preparing/setup log", () => {
    const presentation = presentWorkspaceCreationReceipt({
      phase: "creating",
      noun: "worktree",
      workspacePath: "/repo/worktrees/prism",
      setupCommand: "pnpm install",
    });

    expect(presentation.line).toBe("Creating worktree");
    // The noun rides the presentation so the view can key the settled
    // leading glyph on it (fork = worktree-only, PRO-251).
    expect(presentation.noun).toBe("worktree");
    expect(presentation.showSpinner).toBe(true);
    expect(presentation.busyLabel).toBeNull();
    expect(presentation.defaultExpanded).toBe(false);
    expect(presentation.showRerun).toBe(false);
    expect(presentation.showCreationRetry).toBe(false);
    expect(presentation.logLines).toEqual([
      { text: "Preparing worktree at /repo/worktrees/prism", tone: "default" },
      { text: "$ pnpm install", tone: "default" },
    ]);
  });

  it("created + setup queued (no rerun): busy label, spinner, queued log line", () => {
    const presentation = presentWorkspaceCreationReceipt({
      phase: "created",
      noun: "worktree",
      workspacePath: "/repo/worktrees/prism",
      materializedWorkspaceId: "workspace-1",
      setup: setupSource({ status: "queued" }),
    });

    expect(presentation.line).toBe("Worktree created");
    expect(presentation.busyLabel).toBe("Setup queued");
    expect(presentation.showSpinner).toBe(true);
    expect(presentation.defaultExpanded).toBe(false);
    expect(presentation.showRerun).toBe(false);
    expect(presentation.logLines).toEqual([
      { text: "Worktree created at /repo/worktrees/prism", tone: "default" },
      { text: "$ pnpm install", tone: "default" },
      { text: "Setup script queued...", tone: "default" },
    ]);
  });

  it("creation-failed: defaults expanded, carries a destructive error line, and offers retry", () => {
    const presentation = presentWorkspaceCreationReceipt({
      phase: "creation-failed",
      noun: "worktree",
      workspacePath: "/repo/worktrees/prism",
      errorMessage: "git worktree add failed: branch already checked out",
    });

    expect(presentation.line).toBe("Worktree creation failed");
    expect(presentation.defaultExpanded).toBe(true);
    expect(presentation.showSpinner).toBe(false);
    expect(presentation.showCreationRetry).toBe(true);
    expect(presentation.showRerun).toBe(false);
    expect(presentation.logLines).toEqual([
      { text: "Preparing worktree at /repo/worktrees/prism", tone: "default" },
      { text: "git worktree add failed: branch already checked out", tone: "destructive" },
    ]);
  });

  it("creation-failed: falls back to the generic detail line when errorMessage is empty", () => {
    const presentation = presentWorkspaceCreationReceipt({
      phase: "creation-failed",
      noun: "workspace",
      workspacePath: null,
      errorMessage: null,
    });

    expect(presentation.noun).toBe("workspace");
    expect(presentation.logLines).toEqual([
      { text: "Workspace creation failed.", tone: "destructive" },
    ]);
  });

  it("created + setup failed: sentence carries failure in words, log ends with the failure summary, rerun offered", () => {
    const presentation = presentWorkspaceCreationReceipt({
      phase: "created",
      noun: "worktree",
      workspacePath: "/repo/worktrees/prism",
      materializedWorkspaceId: "workspace-1",
      setup: setupSource({
        status: "failed",
        failureSummary: "Setup failed with exit code 1: pnpm ERR! ENOENT",
      }),
    });

    expect(presentation.line).toBe("Worktree created, but setup failed");
    expect(presentation.defaultExpanded).toBe(true);
    expect(presentation.showRerun).toBe(true);
    expect(presentation.rerunDisabled).toBe(false);
    expect(presentation.logLines).toEqual([
      { text: "Worktree created at /repo/worktrees/prism", tone: "default" },
      { text: "$ pnpm install", tone: "default" },
      { text: "Setup failed with exit code 1: pnpm ERR! ENOENT", tone: "destructive" },
    ]);
  });

  it("created + setup running with a previous failure: busy label, faint previous-run line, rerun disabled", () => {
    const presentation = presentWorkspaceCreationReceipt(
      {
        phase: "created",
        noun: "worktree",
        workspacePath: "/repo/worktrees/prism",
        materializedWorkspaceId: "workspace-1",
        setup: setupSource({ status: "running" }),
      },
      { previousFailureSummary: "Setup failed with exit code 1: pnpm ERR! ENOENT" },
    );

    expect(presentation.line).toBe("Worktree created");
    expect(presentation.busyLabel).toBe("Setup running");
    expect(presentation.showSpinner).toBe(true);
    expect(presentation.defaultExpanded).toBe(true);
    expect(presentation.showRerun).toBe(true);
    expect(presentation.rerunDisabled).toBe(true);
    expect(presentation.rerunLabel).toBe("Rerunning…");
    expect(presentation.logLines).toContainEqual({
      text: "Setup failed with exit code 1 (previous run)",
      tone: "faint",
    });
  });

  it("created + setup succeeded: quiet line, collapsed, no rerun", () => {
    const presentation = presentWorkspaceCreationReceipt({
      phase: "created",
      noun: "worktree",
      workspacePath: "/repo/worktrees/prism",
      materializedWorkspaceId: "workspace-1",
      setup: setupSource({ status: "succeeded" }),
    });

    expect(presentation.line).toBe("Worktree created");
    expect(presentation.defaultExpanded).toBe(false);
    expect(presentation.showRerun).toBe(false);
    expect(presentation.showSpinner).toBe(false);
    expect(presentation.logLines).toEqual([
      { text: "Worktree created at /repo/worktrees/prism", tone: "default" },
      { text: "Setup completed successfully · pnpm install", tone: "default" },
    ]);
  });

  it("created + setup succeeded after a previous failure: sentence switches to setup completed", () => {
    const presentation = presentWorkspaceCreationReceipt(
      {
        phase: "created",
        noun: "worktree",
        workspacePath: "/repo/worktrees/prism",
        materializedWorkspaceId: "workspace-1",
        setup: setupSource({ status: "succeeded" }),
      },
      { previousFailureSummary: "Setup failed with exit code 1: pnpm ERR! ENOENT" },
    );

    expect(presentation.line).toBe("Worktree created, setup completed");
    expect(presentation.defaultExpanded).toBe(false);
    expect(presentation.showRerun).toBe(false);
    expect(presentation.logLines).toContainEqual({
      text: "Setup failed with exit code 1 (previous run)",
      tone: "faint",
    });
  });

  it("created with no setup status: path-only log, no command line when unconfigured", () => {
    const presentation = presentWorkspaceCreationReceipt({
      phase: "created",
      noun: "workspace",
      workspacePath: "/repo/local-ws",
      materializedWorkspaceId: "workspace-1",
      setup: setupSource({ command: null, status: null }),
    });

    expect(presentation.line).toBe("Workspace created");
    expect(presentation.logLines).toEqual([
      { text: "Workspace created at /repo/local-ws", tone: "default" },
    ]);
    expect(presentation.showSpinner).toBe(false);
    expect(presentation.defaultExpanded).toBe(false);
  });
});

describe("workspaceCreationReceiptCopyText", () => {
  it("joins log lines with newlines, ignoring tone", () => {
    const text = workspaceCreationReceiptCopyText([
      { text: "Worktree created at /repo/worktrees/prism", tone: "default" },
      { text: "$ pnpm install", tone: "default" },
      { text: "Setup failed with exit code 1: boom", tone: "destructive" },
    ]);

    expect(text).toBe(
      "Worktree created at /repo/worktrees/prism\n$ pnpm install\nSetup failed with exit code 1: boom",
    );
  });

  it("returns an empty string for no log lines", () => {
    expect(workspaceCreationReceiptCopyText([])).toBe("");
  });
});

// Sanity: the discriminated union accepts a fully-typed "creating" source
// with no path/command known yet (both null).
describe("presentWorkspaceCreationReceipt phase coverage", () => {
  it("accepts a creating source before workspacePath is known", () => {
    const source: WorkspaceCreationReceiptSource = {
      phase: "creating",
      noun: "workspace",
      workspacePath: null,
      setupCommand: null,
    };
    const presentation = presentWorkspaceCreationReceipt(source);
    expect(presentation.logLines).toEqual([]);
  });
});
