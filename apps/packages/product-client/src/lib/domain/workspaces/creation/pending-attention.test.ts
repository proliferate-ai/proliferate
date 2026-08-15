import { describe, expect, it } from "vitest";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry,
  type PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  isPendingWorkspaceEntryAttended,
  resolveAttendedPendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-attention";
import {
  EMPTY_PENDING_WORKSPACE_REGISTRY,
  upsertPendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";

const NO_SELECTION = { selectedLogicalWorkspaceId: null, selectedWorkspaceId: null };

describe("pending workspace attention", () => {
  it("attends the attempt whose pending shell is selected", () => {
    const pending = entry("attempt-a");

    expect(isPendingWorkspaceEntryAttended(pending, {
      selectedLogicalWorkspaceId: buildPendingWorkspaceUiKey(pending),
      selectedWorkspaceId: null,
    })).toBe(true);
  });

  it("attends a materialized attempt while its workspace is selected", () => {
    const pending = { ...entry("attempt-a"), workspaceId: "workspace-1" };

    expect(isPendingWorkspaceEntryAttended(pending, {
      selectedLogicalWorkspaceId: "workspace-1",
      selectedWorkspaceId: "workspace-1",
    })).toBe(true);
  });

  it("does not attend an attempt the user has switched away from", () => {
    const pending = { ...entry("attempt-a"), workspaceId: "workspace-1" };

    expect(isPendingWorkspaceEntryAttended(pending, {
      selectedLogicalWorkspaceId: "workspace-other",
      selectedWorkspaceId: "workspace-other",
    })).toBe(false);
    expect(isPendingWorkspaceEntryAttended(pending, NO_SELECTION)).toBe(false);
    expect(isPendingWorkspaceEntryAttended(null, NO_SELECTION)).toBe(false);
  });

  it("never attends an unmaterialized attempt through a null workspace id", () => {
    expect(isPendingWorkspaceEntryAttended(entry("attempt-a"), {
      selectedLogicalWorkspaceId: null,
      selectedWorkspaceId: null,
    })).toBe(false);
  });

  it("resolves the attended attempt out of several in flight", () => {
    const attended = entry("attempt-a");
    const background = { ...entry("attempt-b"), workspaceId: "workspace-b" };
    const registry = upsertPendingWorkspaceEntry(
      upsertPendingWorkspaceEntry(EMPTY_PENDING_WORKSPACE_REGISTRY, background),
      attended,
    );

    expect(resolveAttendedPendingWorkspaceEntry(registry, {
      selectedLogicalWorkspaceId: buildPendingWorkspaceUiKey(attended),
      selectedWorkspaceId: null,
    })).toBe(attended);
    expect(resolveAttendedPendingWorkspaceEntry(registry, {
      selectedLogicalWorkspaceId: "workspace-b",
      selectedWorkspaceId: "workspace-b",
    })).toBe(background);
    expect(resolveAttendedPendingWorkspaceEntry(registry, NO_SELECTION)).toBeNull();
  });
});

function entry(attemptId: string): PendingWorkspaceEntry {
  return buildSubmittingPendingWorkspaceEntry({
    attemptId,
    selectedWorkspaceId: null,
    source: "worktree-created",
    displayName: "feature-branch",
    request: { kind: "local", sourceRoot: "/tmp/repo" },
  });
}
