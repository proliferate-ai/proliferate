import { beforeEach, describe, expect, it } from "vitest";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry,
  type PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  EMPTY_PENDING_WORKSPACE_REGISTRY,
  pendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";
import {
  enterPendingWorkspaceAttemptShell,
  getPendingWorkspaceEntry,
  isAttemptAttended,
  isAttemptLive,
  patchAttempt,
} from "#product/hooks/workspaces/workflows/pending-workspace-attempt-access";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

describe("pending workspace attempt access", () => {
  beforeEach(() => {
    useSessionSelectionStore.setState({
      pendingWorkspaces: EMPTY_PENDING_WORKSPACE_REGISTRY,
      selectedLogicalWorkspaceId: null,
      selectedWorkspaceId: null,
    });
  });

  it("keeps an attempt live after the user switches away from it", () => {
    const pending = entry("attempt-a");
    useSessionSelectionStore.getState().enterPendingWorkspaceShell(pending);
    expect(isAttemptAttended("attempt-a")).toBe(true);

    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: "workspace-other",
      workspaceId: "workspace-other",
    });

    expect(isAttemptLive("attempt-a")).toBe(true);
    expect(isAttemptAttended("attempt-a")).toBe(false);
  });

  it("reports a dismissed attempt as neither live nor attended", () => {
    useSessionSelectionStore.getState().setPendingWorkspaceEntry(entry("attempt-a"));
    useSessionSelectionStore.getState().clearPendingWorkspaceEntry("attempt-a");

    expect(getPendingWorkspaceEntry("attempt-a")).toBeNull();
    expect(isAttemptLive("attempt-a")).toBe(false);
    expect(isAttemptAttended("attempt-a")).toBe(false);
  });

  it("attends a materialized attempt whose workspace is selected", () => {
    const pending = { ...entry("attempt-a"), workspaceId: "workspace-1" };
    useSessionSelectionStore.getState().setPendingWorkspaceEntry(pending);
    useSessionSelectionStore.setState({
      selectedLogicalWorkspaceId: "workspace-1",
      selectedWorkspaceId: "workspace-1",
    });

    expect(isAttemptAttended("attempt-a")).toBe(true);
    expect(buildPendingWorkspaceUiKey(pending)).toBe("pending-workspace:attempt-a");
  });

  it("patches only the named attempt and ignores a dismissed one", () => {
    useSessionSelectionStore.getState().setPendingWorkspaceEntry(entry("attempt-a"));
    useSessionSelectionStore.getState().setPendingWorkspaceEntry(entry("attempt-b"));

    patchAttempt("attempt-a", { stage: "failed", errorMessage: "Could not create it." });
    patchAttempt("attempt-missing", { stage: "failed" });

    const registry = useSessionSelectionStore.getState().pendingWorkspaces;
    expect(pendingWorkspaceEntry(registry, "attempt-a")).toMatchObject({
      stage: "failed",
      errorMessage: "Could not create it.",
    });
    expect(pendingWorkspaceEntry(registry, "attempt-b")?.stage).toBe("submitting");
    expect(registry.attemptOrder).toEqual(["attempt-a", "attempt-b"]);
  });
  it("attends an unattended attempt without disturbing the others", () => {
    // Clicking a pending sidebar row, or a failure toast's Show, lands here for
    // an attempt the user is not currently watching (PRO-230).
    useSessionSelectionStore.getState().setPendingWorkspaceEntry(entry("attempt-a"));
    useSessionSelectionStore.getState().setPendingWorkspaceEntry(entry("attempt-b"));
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: "workspace-other",
      workspaceId: "workspace-other",
    });

    expect(enterPendingWorkspaceAttemptShell("attempt-b")).toBe(true);

    expect(isAttemptAttended("attempt-b")).toBe(true);
    expect(useSessionSelectionStore.getState().selectedLogicalWorkspaceId)
      .toBe(buildPendingWorkspaceUiKey({ attemptId: "attempt-b" }));
    expect(useSessionSelectionStore.getState().pendingWorkspaces.attemptOrder)
      .toEqual(["attempt-a", "attempt-b"]);
  });

  it("does nothing for an attempt that is already gone", () => {
    expect(enterPendingWorkspaceAttemptShell("attempt-missing")).toBe(false);
    expect(useSessionSelectionStore.getState().selectedLogicalWorkspaceId).toBeNull();
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
