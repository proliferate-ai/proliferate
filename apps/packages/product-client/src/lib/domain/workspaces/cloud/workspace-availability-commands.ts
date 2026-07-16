import type { Workspace } from "@anyharness/sdk";
import type {
  CloudWorkspaceMaterializationSummary,
  CloudWorkspaceSummary,
} from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import type { WorkspaceGitStatus } from "#product/lib/domain/workspaces/git-status/workspace-git-status-model";

/**
 * The workspace-copy availability commands (PR 5 UI action model). One pure,
 * DOM-free command model derived from a logical workspace's local/Cloud
 * materialization state, shared by the DOM three-dot menu (WorkspaceItemMenu)
 * and the native context-menu builder so the two stay in exact parity.
 *
 * The repo `…` menu owns repository availability; this owns workspace-copy
 * availability. V1 exposes only the safe core lifecycle — unsupported Git
 * states surface a truthful, selectable blocker rather than an action.
 */
export type WorkspaceAvailabilityCommandKind =
  | "add-cloud-copy"
  | "open-on-this-mac"
  | "link-copies"
  | "relink-existing"
  | "recreate-on-this-mac"
  | "unlink-this-mac"
  | "unsupported-git-state";

export interface WorkspaceAvailabilityCommand {
  kind: WorkspaceAvailabilityCommandKind;
  label: string;
  /** Blockers describe why a command is present but not actionable (unsupported
   * Git state). An actionable command has no blocker. */
  blocker?: string;
}

export interface WorkspaceAvailabilityInput {
  /** True when this logical workspace has a local AnyHarness workspace on this
   * install. */
  hasLocalWorkspace: boolean;
  /** The Cloud workspace summary, or null for a local-only workspace. */
  cloudWorkspace: Pick<
    CloudWorkspaceSummary,
    "materializations"
  > | null;
  /** This install's id, or null on Web / no native worker. */
  desktopInstallId: string | null;
  /** True when the local and Cloud copies are the same exact ref and clean,
   * making them a plausible Link candidate. Only meaningful when both a local
   * workspace and an unlinked Cloud workspace are present. */
  linkCandidate?: boolean;
  /** True when this install's linked local materialization is missing or
   * inconsistent (needs relink/recreate). */
  localMaterializationNeedsRepair?: boolean;
  /** A truthful blocker for an unsupported Git state (dirty, detached, mid-op,
   * unpublished). When set, the only command is the selectable blocker. */
  unsupportedGitBlocker?: string | null;
}

/**
 * A local workspace's git status is "safe for a durable Cloud association"
 * only when V1's exact core is met: a known-clean, conflict-free, normal-branch
 * state with an upstream and zero ahead/behind. Anything else (or unknown
 * status) yields a truthful blocker string rather than an action. Expansion to
 * richer repair is PR 6.
 */
export function unsupportedGitBlockerForLocalWorkspace(
  gitStatus: WorkspaceGitStatus | null | undefined,
): string | null {
  if (!gitStatus) {
    // No status yet: do not offer a durable action on an unknown state.
    return "Git status for this workspace is not available yet.";
  }
  if (gitStatus.conflicted === true) {
    return "This workspace has unresolved merge conflicts.";
  }
  if (gitStatus.dirty === true) {
    return "This workspace has uncommitted changes.";
  }
  if (gitStatus.dirty === null || gitStatus.conflicted === null) {
    return "Git status for this workspace is not available yet.";
  }
  if (gitStatus.hasUpstream === false) {
    return "This workspace branch has not been published upstream.";
  }
  if ((gitStatus.ahead ?? 0) !== 0 || (gitStatus.behind ?? 0) !== 0) {
    return "This workspace branch is not in sync with its upstream.";
  }
  return null;
}

/**
 * Adapt a logical workspace's parts into the availability input. Pure so the
 * derivation (unsupported-git-state, link candidacy, repair) is unit-testable
 * away from the sidebar. `localGitStatus` gates ONLY the actions that mutate a
 * durable association from a local source (Add Cloud copy / Link); an
 * already-linked or Cloud-only workspace never blocks on it.
 */
export function deriveWorkspaceAvailabilityInput(args: {
  localWorkspace: Pick<Workspace, "id"> | null;
  cloudWorkspace: Pick<CloudWorkspaceSummary, "materializations"> | null;
  desktopInstallId: string | null;
  localGitStatus: WorkspaceGitStatus | null | undefined;
  /** True when a heuristic same-repo/branch local+Cloud pair is a plausible,
   * not-yet-linked Link candidate. */
  linkCandidate?: boolean;
}): WorkspaceAvailabilityInput {
  const linkedLocal = localMaterializationForInstall(args.cloudWorkspace, args.desktopInstallId);
  const isExplicitlyLinked = linkedLocal !== null;
  const localNeedsRepair = isExplicitlyLinked
    && (linkedLocal!.state === "missing"
      || linkedLocal!.state === "inconsistent"
      || linkedLocal!.state === "failed");

  // The unsupported-git blocker only applies to the two source-mutating
  // actions (Add Cloud copy from a local source, Link a local source). A
  // Cloud-only "Open on this Mac", an explicit link's Unlink, or a repair path
  // must stay available regardless of the local working tree.
  const wantsSourceMutation = (!!args.localWorkspace && !args.cloudWorkspace)
    || (!!args.localWorkspace && !!args.cloudWorkspace && !isExplicitlyLinked && !!args.linkCandidate);
  const unsupportedGitBlocker = wantsSourceMutation
    ? unsupportedGitBlockerForLocalWorkspace(args.localGitStatus)
    : null;

  return {
    hasLocalWorkspace: !!args.localWorkspace,
    cloudWorkspace: args.cloudWorkspace,
    desktopInstallId: args.desktopInstallId,
    linkCandidate: args.linkCandidate,
    localMaterializationNeedsRepair: localNeedsRepair,
    unsupportedGitBlocker,
  };
}

function localMaterializationForInstall(
  cloudWorkspace: WorkspaceAvailabilityInput["cloudWorkspace"],
  desktopInstallId: string | null,
): CloudWorkspaceMaterializationSummary | null {
  if (!cloudWorkspace || !desktopInstallId) {
    return null;
  }
  const rows = cloudWorkspace.materializations ?? [];
  return (
    rows.find(
      (row) =>
        row.targetKind === "local_desktop" && row.desktopInstallId === desktopInstallId,
    ) ?? null
  );
}

/**
 * Resolve the availability commands for a workspace's `…` menu, ordered as they
 * appear in the menu. Pure: given the same input it returns the same commands,
 * so the DOM and native menus render identically.
 */
export function resolveWorkspaceAvailabilityCommands(
  input: WorkspaceAvailabilityInput,
): WorkspaceAvailabilityCommand[] {
  // An unsupported Git state blocks every mutation; show the truthful, still
  // selectable blocker only (expansion is PR 6). Never offer an action that
  // would reset/merge/rebase to "fix" it.
  if (input.unsupportedGitBlocker) {
    return [
      {
        kind: "unsupported-git-state",
        label: "Unsupported Git state",
        blocker: input.unsupportedGitBlocker,
      },
    ];
  }

  const linkedLocal = localMaterializationForInstall(input.cloudWorkspace, input.desktopInstallId);
  const isExplicitlyLinked = linkedLocal !== null;

  // Cloud-only: no local copy on this install and no explicit link → offer to
  // open a copy on this Mac.
  if (input.cloudWorkspace && !input.hasLocalWorkspace && !isExplicitlyLinked) {
    return [{ kind: "open-on-this-mac", label: "Open on this Mac…" }];
  }

  // Explicitly linked: the linked local copy may be healthy or need repair.
  if (isExplicitlyLinked) {
    if (input.localMaterializationNeedsRepair || !input.hasLocalWorkspace) {
      return [
        { kind: "relink-existing", label: "Relink existing…" },
        { kind: "recreate-on-this-mac", label: "Recreate on this Mac…" },
        { kind: "unlink-this-mac", label: "Unlink this Mac…" },
      ];
    }
    return [{ kind: "unlink-this-mac", label: "Unlink this Mac…" }];
  }

  // Local + unlinked Cloud that match the same exact ref → offer to link.
  if (input.hasLocalWorkspace && input.cloudWorkspace && input.linkCandidate) {
    return [{ kind: "link-copies", label: "Link copies…" }];
  }

  // Local only (no Cloud copy) → offer to add a managed-Cloud copy.
  if (input.hasLocalWorkspace && !input.cloudWorkspace) {
    return [{ kind: "add-cloud-copy", label: "Add Cloud copy…" }];
  }

  return [];
}
