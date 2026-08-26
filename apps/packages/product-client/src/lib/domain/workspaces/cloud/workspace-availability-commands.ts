import type { Workspace } from "@anyharness/sdk";
import type {
  CloudWorkspaceMaterializationSummary,
  CloudWorkspaceSummary,
} from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import type { WorkspaceGitStatus } from "#product/lib/domain/workspaces/git-status/workspace-git-status-model";

/**
 * The workspace-copy availability commands (PR 5 UI action model). One pure,
 * DOM-free command model derived from a logical workspace's local/Cloud
 * materialization state, shared by the DOM context menu (`WorkspaceItem`'s
 * `PopoverButton`) and the native context-menu builder so the two stay in
 * exact parity.
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
  | "reconcile-git-state";

export interface WorkspaceAvailabilityCommand {
  kind: WorkspaceAvailabilityCommandKind;
  label: string;
  /** A truthful one-line note on why this command is offered (e.g. the
   * unsupported Git state that needs reconciling). Actionable commands may still
   * carry a note; PR 6's `reconcile-git-state` is actionable AND explains why. */
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
  /** Whether Cloud compute is enabled on this deployment. When false, the
   * `add-cloud-copy` command must not be offered — matches the gate applied to
   * fresh-create paths (PRO-10). */
  cloudComputeEnabled: boolean;
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
  /** Whether Cloud compute is enabled on this deployment (PRO-10). */
  cloudComputeEnabled: boolean;
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
    cloudComputeEnabled: args.cloudComputeEnabled,
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
  _input: WorkspaceAvailabilityInput,
): WorkspaceAvailabilityCommand[] {
  // The cloud-copies feature (PR 5/6) died with the cloud workspace stack in
  // cull part 2: the availability action host and the reconciliation dialog
  // that executed every one of these commands are deleted. Offering a command
  // with no executor would be a silent dead-end, so nothing is offered. The
  // vocabulary and input derivation stay for the menus' prop contracts.
  return [];
}
