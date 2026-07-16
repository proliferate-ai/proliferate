import type {
  WorkspaceReconciliationBodyView,
  WorkspaceReconciliationColumnView,
} from "@proliferate/product-ui/workspaces/WorkspaceReconciliationBody";
import {
  classifyWorkspaceGitSide,
  type WorkspaceGitSide,
  type WorkspaceGitSideState,
} from "#product/lib/domain/workspaces/cloud/workspace-git-relation";
import type { WorkspaceGitReconciliationPlan } from "#product/lib/domain/workspaces/cloud/workspace-git-reconciliation";

/**
 * PR 6 — pure mapping from a reconciliation plan + the two Git sides to the
 * props-only WorkspaceReconciliationBody view. Keeps the truthfulness rules in
 * one place: the GitHub column is only rendered when a remote head is actually
 * client-visible (it never is in this PR), so it is shown as a "last-known"
 * caveat rather than a fabricated authoritative HEAD.
 */

export function buildReconciliationBodyView(args: {
  plan: WorkspaceGitReconciliationPlan;
  local: WorkspaceGitSide;
  cloud: WorkspaceGitSide;
}): WorkspaceReconciliationBodyView {
  const { plan, local, cloud } = args;
  const columns: WorkspaceReconciliationColumnView[] = [
    columnFor("This Mac", local, false),
    columnFor("Cloud", cloud, true),
    githubColumn(local, cloud),
  ];
  return {
    title: plan.title,
    columns,
    actionDetail: plan.action.detail,
    cancelPreserves: plan.cancelPreserves,
  };
}

function columnFor(
  title: string,
  side: WorkspaceGitSide,
  isCloud: boolean,
): WorkspaceReconciliationColumnView {
  const state = classifyWorkspaceGitSide(side);
  const { label, tone } = labelForSideState(state);
  // PR6-CLOUD-TRUTH-01: when the Cloud side couldn't be read live (unknown /
  // unreachable), its head is last-REPORTED — label it so and never imply live.
  const cloudLastReported = isCloud
    && (state.kind === "unknown" || state.kind === "unreachable");
  return {
    title,
    branch: side.branch,
    headShort: side.headSha ? side.headSha.slice(0, 7) : null,
    stateLabel: cloudLastReported ? "last-reported" : label,
    stateTone: cloudLastReported ? "neutral" : tone,
    caveat: cloudLastReported
      ? "Cloud runtime wasn't reachable; this is the last-reported commit, not live."
      : undefined,
  };
}

/** The GitHub branch-HEAD column. The authoritative remote HEAD is NOT
 * client-visible (verified GAP §B-9/§D-14): there is no live remote probe and
 * the branches route carries no per-branch SHA. So we render the branch name
 * only, with a "last-known" state and an explicit staleness caveat — never a
 * fabricated remote sha. */
function githubColumn(
  local: WorkspaceGitSide,
  cloud: WorkspaceGitSide,
): WorkspaceReconciliationColumnView {
  const branch = local.branch ?? cloud.branch;
  return {
    title: "GitHub branch",
    branch,
    headShort: null,
    stateLabel: "last-known",
    stateTone: "neutral",
    caveat: "Remote HEAD isn't checked here; verified when the action runs.",
  };
}

function labelForSideState(
  state: WorkspaceGitSideState,
): { label: string; tone: WorkspaceReconciliationColumnView["stateTone"] } {
  switch (state.kind) {
    case "clean":
      return { label: "clean", tone: "success" };
    case "ahead":
      return { label: `${state.commits} ahead`, tone: "info" };
    case "behind":
      return { label: `${state.commits} behind`, tone: "warning" };
    case "diverged":
      return { label: `${state.ahead} ahead, ${state.behind} behind`, tone: "warning" };
    case "dirty":
      return { label: "uncommitted changes", tone: "warning" };
    case "conflicted":
      return { label: "conflicts", tone: "destructive" };
    case "operation":
      return { label: "operation in progress", tone: "warning" };
    case "detached":
      return { label: "detached HEAD", tone: "warning" };
    case "unpublished":
      return { label: "not published", tone: "warning" };
    case "missing":
      return { label: "missing", tone: "destructive" };
    case "absent":
      return { label: "not created", tone: "neutral" };
    case "unreachable":
      return { label: "unreachable", tone: "neutral" };
    case "unknown":
      return { label: "unknown", tone: "neutral" };
  }
}
