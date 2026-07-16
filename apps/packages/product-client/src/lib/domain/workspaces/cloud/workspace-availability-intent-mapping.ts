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
    case "unsupported-git-state":
      // A truthful, non-actionable blocker (expansion is PR 6).
      return null;
  }
}
