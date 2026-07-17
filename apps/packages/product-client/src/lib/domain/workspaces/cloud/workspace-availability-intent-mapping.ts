import type { WorkspaceAvailabilityCommandKind } from "#product/lib/domain/workspaces/cloud/workspace-availability-commands";
import type { WorkspaceAvailabilityIntent } from "#product/stores/cloud/workspace-availability-intent-store";

/** The identifiers a sidebar item carries for availability actions (PR 5). */
export interface WorkspaceAvailabilityActionTarget {
  localWorkspaceId: string | null;
  cloudWorkspaceId: string | null;
  linkedMaterializationId: string | null;
  repoOwner: string | null;
  repoName: string | null;
}

/**
 * Map a selected availability command + its item's identifiers to the intent
 * the connected host executes, or null when the required identifiers are
 * missing (or the command is a non-actionable blocker). Pure so the sidebar
 * wiring is unit-testable without a DOM.
 */
export function workspaceAvailabilityIntentForCommand(
  kind: WorkspaceAvailabilityCommandKind,
  target: WorkspaceAvailabilityActionTarget,
): WorkspaceAvailabilityIntent | null {
  switch (kind) {
    case "add-cloud-copy":
      if (target.localWorkspaceId && target.repoOwner && target.repoName) {
        return {
          kind: "add_cloud_copy",
          localWorkspaceId: target.localWorkspaceId,
          gitOwner: target.repoOwner,
          gitRepoName: target.repoName,
        };
      }
      return null;
    case "open-on-this-mac":
      return target.cloudWorkspaceId
        ? { kind: "open_on_mac", cloudWorkspaceId: target.cloudWorkspaceId }
        : null;
    case "link-copies":
      // Flow 4 is association-only: adopt an EXISTING local workspace proven to
      // match the Cloud copy's exact ref. It never re-materializes, so it maps to
      // a distinct intent from relink/recreate (which do materialize). The host
      // resolves + verifies the chosen local candidate (PR5-LINK-01/02).
      return target.cloudWorkspaceId
        ? { kind: "link_copies", cloudWorkspaceId: target.cloudWorkspaceId }
        : null;
    case "relink-existing":
      return target.cloudWorkspaceId
        ? { kind: "relink", cloudWorkspaceId: target.cloudWorkspaceId, mode: "relink" }
        : null;
    case "recreate-on-this-mac":
      return target.cloudWorkspaceId
        ? { kind: "relink", cloudWorkspaceId: target.cloudWorkspaceId, mode: "recreate" }
        : null;
    case "unlink-this-mac":
      return target.cloudWorkspaceId && target.linkedMaterializationId
        ? {
          kind: "unlink",
          cloudWorkspaceId: target.cloudWorkspaceId,
          materializationId: target.linkedMaterializationId,
        }
        : null;
    case "reconcile-git-state": {
      // PR 6: open the one reconciliation dialog. reconcile-git-state is only
      // offered when a SOURCE-MUTATING action was blocked by Git state (Add Cloud
      // copy from a local source, or Link a local source), so we resume THAT
      // action after the user resolves the block — never a dead end
      // (PR6-CONTINUATION-02). Infer the continuation from the target shape.
      if (!target.localWorkspaceId && !target.cloudWorkspaceId) {
        return null;
      }
      const continuation = resolveReconcileContinuation(target);
      return {
        kind: "reconcile",
        localWorkspaceId: target.localWorkspaceId,
        cloudWorkspaceId: target.cloudWorkspaceId,
        materializationId: target.linkedMaterializationId,
        continuation,
      };
    }
  }
}

/** Infer the originating (blocked) action to resume after reconciliation. The
 * reconcile-git-state command replaces a blocked source-mutating action: a
 * local-only source wanted Add Cloud copy; a local + unlinked Cloud pair wanted
 * Link. A cloud-only / linked case has no source mutation to resume. */
function resolveReconcileContinuation(
  target: WorkspaceAvailabilityActionTarget,
): NonNullable<Extract<WorkspaceAvailabilityIntent, { kind: "reconcile" }>["continuation"]> {
  if (target.localWorkspaceId && target.cloudWorkspaceId) {
    return { kind: "link_copies", cloudWorkspaceId: target.cloudWorkspaceId };
  }
  if (target.localWorkspaceId && target.repoOwner && target.repoName) {
    return {
      kind: "add_cloud_copy",
      localWorkspaceId: target.localWorkspaceId,
      gitOwner: target.repoOwner,
      gitRepoName: target.repoName,
    };
  }
  return { kind: "standalone" };
}
