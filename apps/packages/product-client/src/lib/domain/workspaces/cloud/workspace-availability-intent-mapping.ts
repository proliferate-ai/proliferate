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
    case "unsupported-git-state":
      // A truthful, non-actionable blocker (expansion is PR 6).
      return null;
  }
}
