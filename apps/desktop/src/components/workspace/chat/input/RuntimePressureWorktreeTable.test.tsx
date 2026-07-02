// @vitest-environment jsdom

import type { WorktreeGitStatusSummary, WorktreeInventoryRow } from "@anyharness/sdk";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeWorktreeRow, formatByteEstimate } from "./RuntimePressureWorktreeTable";

function gitStatus(
  overrides: Partial<WorktreeGitStatusSummary> = {},
): WorktreeGitStatusSummary {
  return {
    state: "clean",
    clean: true,
    conflicted: false,
    ahead: 0,
    behind: 0,
    changedFileCount: 0,
    untrackedFileCount: 0,
    branch: null,
    upstreamBranch: null,
    errorMessage: null,
    ...overrides,
  };
}

function inventoryRow(overrides: Partial<WorktreeInventoryRow> = {}): WorktreeInventoryRow {
  return {
    id: "wt-1",
    path: "/Users/dev/.proliferate/worktrees/proliferate/thread-1",
    canonicalPath: null,
    branch: "thread/123e4567-e89b-12d3-a456-426614174000",
    repoRootId: "repo-root",
    repoRootName: "proliferate",
    state: "associated",
    managed: true,
    materialized: true,
    availableActions: ["delete_workspace_history"],
    blockers: [],
    associatedWorkspaces: [
      {
        id: "ws-1",
        displayName: "Settings polish",
        branch: "thread/123e4567-e89b-12d3-a456-426614174000",
        kind: "worktree",
        lifecycleState: "active",
        cleanupState: "none",
        sessionCount: 0,
      },
    ],
    totalSessionCount: 0,
    gitStatus: gitStatus(),
    storage: {
      worktreeBytes: 33 * 1024 * 1024,
      sqliteBytes: 653 * 1024,
      totalBytes: null,
    },
    ...overrides,
  };
}

function renderRow(row: WorktreeInventoryRow) {
  return render(
    <RuntimeWorktreeRow
      row={row}
      onDeleteOrphan={vi.fn()}
      onPurgeWorkspace={vi.fn()}
    />,
  );
}

describe("RuntimeWorktreeRow", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders clean status as plain muted text, not a badge", () => {
    renderRow(inventoryRow());

    const status = screen.getByText("Clean");
    expect(status.className).toContain("text-muted-foreground");
    expect(status.className).not.toContain("rounded-full");
  });

  it("keeps a toned badge for dirty and conflicted states", () => {
    renderRow(inventoryRow({
      gitStatus: gitStatus({ state: "dirty", clean: false, changedFileCount: 3 }),
    }));
    const changes = screen.getByText("Changes");
    expect(changes.className).toContain("rounded-full");
    expect(changes.className).toContain("text-warning");
    cleanup();

    renderRow(inventoryRow({
      gitStatus: gitStatus({ state: "conflicted", clean: false, conflicted: true }),
    }));
    const conflicts = screen.getByText("Conflicts");
    expect(conflicts.className).toContain("rounded-full");
    expect(conflicts.className).toContain("text-destructive");
  });

  it("renders zero chats as a muted em dash and keeps non-zero counts", () => {
    renderRow(inventoryRow({ totalSessionCount: 0 }));
    expect(screen.getByText("—")).not.toBeNull();
    cleanup();

    renderRow(inventoryRow({ totalSessionCount: 3 }));
    expect(screen.getByText("3")).not.toBeNull();
    expect(screen.queryByText("—")).toBeNull();
  });

  it("renders sizes without the tilde in table cells", () => {
    renderRow(inventoryRow());

    expect(screen.getByText("33 MB")).not.toBeNull();
    expect(screen.getByText("653 KB")).not.toBeNull();
    expect(screen.queryByText("~33 MB")).toBeNull();
  });

  it("exposes full name and branch values as title tooltips on truncated cells", () => {
    renderRow(inventoryRow());

    const name = screen.getByText("Settings polish");
    expect(name.getAttribute("title")).toBe("Settings polish");

    const branchLine = "proliferate / thread/123e4567-e89b-12d3-a456-426614174000";
    const branch = screen.getByText(branchLine);
    expect(branch.getAttribute("title")).toBe(branchLine);
  });
});

describe("formatByteEstimate", () => {
  it("formats plain values for cells and tilde-prefixed values for totals", () => {
    expect(formatByteEstimate(33 * 1024 * 1024)).toBe("33 MB");
    expect(formatByteEstimate(33 * 1024 * 1024, true)).toBe("~33 MB");
    expect(formatByteEstimate(512)).toBe("512 B");
    expect(formatByteEstimate(512, true)).toBe("~512 B");
    expect(formatByteEstimate(1536)).toBe("1.5 KB");
    expect(formatByteEstimate(null)).toBe("--");
    expect(formatByteEstimate(undefined, true)).toBe("--");
  });
});
