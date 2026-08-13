import { formatRelativeTime } from "#product/lib/domain/workspaces/display/workspace-display";
import type { StatusDotFill, StatusDotTone } from "#product/primitives/StatusDot";
import type {
  WorkspaceGitStatus,
  WorkspacePrStatus,
} from "#product/lib/domain/workspaces/git-status/workspace-git-status-model";

export type PrStatusKind =
  | "open"
  | "checks_failing"
  | "pending"
  | "changes_requested"
  | "draft"
  | "merged"
  | "closed";

export interface PrStatusView {
  kind: PrStatusKind;
  /** PR number, when known (rendered in the tooltip as `#805`). */
  number?: number | null;
  /** Optional custom tooltip label; defaults to `PR #{n} · {State}`. */
  label?: string | null;
}

/** The two `StatusDot` axes a PR kind resolves to. */
export interface PrStatusDotAppearance {
  tone: StatusDotTone;
  fill: StatusDotFill;
}

/**
 * Maps a PR kind onto the `StatusDot` axes (UX spec §3.3 dot table).
 *
 * The presenter lives here, beside `PrStatusKind`, rather than inside the
 * badge: the mapping is domain knowledge ("checks failing is a red dot"), and
 * the badge is a pure `StatusDot` call site once it is lifted out.
 *
 * Every tone is an opaque ink — no alpha tokens. `pending` is the only
 * in-flight state, so it is the only hollow one: an outline, not a fill.
 * `merged` is the GitHub-convention purple, never `info` (the unread colour).
 */
export function prStatusTone(kind: PrStatusKind): PrStatusDotAppearance {
  switch (kind) {
    case "open":
      return { tone: "success", fill: "solid" };
    case "checks_failing":
      return { tone: "danger", fill: "solid" };
    case "pending":
      return { tone: "warning", fill: "hollow" };
    case "changes_requested":
      return { tone: "warning", fill: "solid" };
    case "draft":
      return { tone: "muted", fill: "solid" };
    case "merged":
      return { tone: "merged", fill: "solid" };
    case "closed":
      return { tone: "danger", fill: "solid" };
  }
}

const PR_STATE_LABEL: Record<Exclude<WorkspacePrStatus["state"], "none">, string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
};

function prStatusKind(pr: WorkspacePrStatus): PrStatusKind | null {
  switch (pr.state) {
    case "none":
      return null;
    case "draft":
      return "draft";
    case "merged":
      return "merged";
    case "closed":
      return "closed";
    case "open":
      if (pr.checks === "failing") {
        return "checks_failing";
      }
      if (pr.checks === "pending") {
        return "pending";
      }
      if (pr.reviewDecision === "changes_requested") {
        return "changes_requested";
      }
      return "open";
  }
}

/**
 * Full tooltip for a PR row ("PR #805 · Open · Checks failing"). Draft rows
 * include checks/review segments too; merged/closed rows carry only the state.
 * Snapshot-sourced statuses get an "as of {rel}" suffix so stale data reads as
 * stale. Returns null when there is no PR to describe.
 */
export function prStatusCompoundLabel(
  status: WorkspaceGitStatus | null | undefined,
): string | null {
  const pr = status?.pr;
  if (!status || !pr || pr.state === "none") {
    return null;
  }

  const parts: string[] = [
    typeof pr.number === "number" ? `PR #${pr.number}` : "PR",
    PR_STATE_LABEL[pr.state],
  ];

  if (pr.state === "open" || pr.state === "draft") {
    if (pr.checks === "failing") {
      parts.push("Checks failing");
    } else if (pr.checks === "pending") {
      parts.push("Checks pending");
    }
    if (pr.reviewDecision === "changes_requested") {
      parts.push("Changes requested");
    } else if (pr.reviewDecision === "approved") {
      parts.push("Approved");
    }
  }

  const label = parts.join(" · ");
  return status.source === "snapshot"
    ? `${label} · as of ${formatRelativeTime(status.capturedAt)}`
    : label;
}

/**
 * Maps a composed git status to the PrStatusBadge view (§3.3 dot table).
 * Returns null when PR data is unknown (`pr: null`) or authoritatively absent
 * (`state: "none"`) — no dot is rendered in either case.
 */
export function prStatusViewFromGitStatus(
  status: WorkspaceGitStatus | null | undefined,
): PrStatusView | null {
  const pr = status?.pr;
  if (!status || !pr) {
    return null;
  }
  const kind = prStatusKind(pr);
  if (!kind) {
    return null;
  }
  return {
    kind,
    number: pr.number,
    label: prStatusCompoundLabel(status),
  };
}

/** "#805" — compact PR number label for workspaces-page rows (§4.1). */
export function prNumberLabelFromGitStatus(
  status: WorkspaceGitStatus | null | undefined,
): string | null {
  const pr = status?.pr;
  if (!pr || pr.state === "none" || typeof pr.number !== "number") {
    return null;
  }
  return `#${pr.number}`;
}

/** "↑2 ↓1" — present only when ahead or behind is > 0 (§4.1). */
export function gitAheadBehindLabel(
  status: WorkspaceGitStatus | null | undefined,
): string | null {
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const parts: string[] = [];
  if (ahead > 0) {
    parts.push(`↑${ahead}`);
  }
  if (behind > 0) {
    parts.push(`↓${behind}`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}
