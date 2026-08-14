import { describe, expect, it } from "vitest";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry,
  type PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  EMPTY_PENDING_WORKSPACE_REGISTRY,
  patchPendingWorkspaceEntry,
  pendingWorkspaceEntries,
  pendingWorkspaceEntry,
  pendingWorkspaceEntryForUiKey,
  pendingWorkspaceEntryForWorkspaceId,
  removePendingWorkspaceEntry,
  upsertPendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";

describe("pending workspace registry", () => {
  it("keeps attempts in launch order and replaces an entry in place", () => {
    const first = entry("attempt-a");
    const second = entry("attempt-b");
    const registry = upsertPendingWorkspaceEntry(
      upsertPendingWorkspaceEntry(EMPTY_PENDING_WORKSPACE_REGISTRY, first),
      second,
    );

    const replaced = upsertPendingWorkspaceEntry(registry, {
      ...first,
      displayName: "renamed",
    });

    expect(replaced.attemptOrder).toEqual(["attempt-a", "attempt-b"]);
    expect(pendingWorkspaceEntry(replaced, "attempt-a")?.displayName).toBe("renamed");
    expect(pendingWorkspaceEntry(replaced, "attempt-b")).toBe(second);
  });

  it("returns the same registry when nothing changes", () => {
    const existing = entry("attempt-a");
    const registry = upsertPendingWorkspaceEntry(EMPTY_PENDING_WORKSPACE_REGISTRY, existing);

    expect(upsertPendingWorkspaceEntry(registry, existing)).toBe(registry);
    expect(patchPendingWorkspaceEntry(registry, "attempt-missing", { stage: "failed" }))
      .toBe(registry);
    expect(removePendingWorkspaceEntry(registry, "attempt-missing")).toBe(registry);
  });

  it("patches one attempt without touching its neighbours", () => {
    const registry = upsertPendingWorkspaceEntry(
      upsertPendingWorkspaceEntry(EMPTY_PENDING_WORKSPACE_REGISTRY, entry("attempt-a")),
      entry("attempt-b"),
    );

    const patched = patchPendingWorkspaceEntry(registry, "attempt-a", {
      stage: "failed",
      errorMessage: "Could not create the worktree.",
    });

    expect(pendingWorkspaceEntry(patched, "attempt-a")).toMatchObject({
      attemptId: "attempt-a",
      stage: "failed",
      errorMessage: "Could not create the worktree.",
    });
    expect(pendingWorkspaceEntry(patched, "attempt-b")).toEqual(entry("attempt-b"));
  });

  it("removes only the attempt asked for", () => {
    const registry = upsertPendingWorkspaceEntry(
      upsertPendingWorkspaceEntry(EMPTY_PENDING_WORKSPACE_REGISTRY, entry("attempt-a")),
      entry("attempt-b"),
    );

    const removed = removePendingWorkspaceEntry(registry, "attempt-a");

    expect(removed.attemptOrder).toEqual(["attempt-b"]);
    expect(pendingWorkspaceEntry(removed, "attempt-a")).toBeNull();
  });

  it("hands back a stable empty list so subscribers do not rerender", () => {
    expect(pendingWorkspaceEntries(EMPTY_PENDING_WORKSPACE_REGISTRY))
      .toBe(pendingWorkspaceEntries(EMPTY_PENDING_WORKSPACE_REGISTRY));
  });

  it("looks an attempt up by materialized workspace id and by pending ui key", () => {
    const materialized = { ...entry("attempt-a"), workspaceId: "workspace-1" };
    const registry = upsertPendingWorkspaceEntry(
      upsertPendingWorkspaceEntry(EMPTY_PENDING_WORKSPACE_REGISTRY, materialized),
      entry("attempt-b"),
    );

    expect(pendingWorkspaceEntryForWorkspaceId(registry, "workspace-1")).toBe(materialized);
    expect(pendingWorkspaceEntryForWorkspaceId(registry, "workspace-other")).toBeNull();
    expect(pendingWorkspaceEntryForUiKey(
      registry,
      buildPendingWorkspaceUiKey({ attemptId: "attempt-b" }),
    )).toEqual(entry("attempt-b"));
    expect(pendingWorkspaceEntryForUiKey(registry, null)).toBeNull();
  });
});

function entry(attemptId: string): PendingWorkspaceEntry {
  return {
    ...buildSubmittingPendingWorkspaceEntry({
      attemptId,
      selectedWorkspaceId: null,
      source: "worktree-created",
      displayName: "feature-branch",
      request: { kind: "local", sourceRoot: "/tmp/repo" },
    }),
    createdAt: 100,
  };
}
