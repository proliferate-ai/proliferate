import type { PrStatusKind, PrStatusView } from "@proliferate/product-ui/workspaces/PrStatusBadge";
import { formatRelativeTime } from "@/lib/domain/workspaces/display/workspace-display";
import type {
  WorkspaceGitStatus,
  WorkspacePrStatus,
} from "@/lib/domain/workspaces/git-status/workspace-git-status-model";

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

export interface SidebarGitGlyph {
  kind: "pull_request" | "branch";
  /** attention === "conflicts" — render destructive tone. */
  conflicted: boolean;
  /** Tooltip content; null renders the glyph without a tooltip. */
  tooltip: string | null;
}

/**
 * Leading-well glyph for idle sidebar rows (§3.2 ladder items 4–6):
 * PR glyph when a PR exists, branch glyph when only branch identity is known,
 * null (empty reserved well) when there is no git data at all.
 */
export function sidebarGitGlyphForStatus(
  status: WorkspaceGitStatus | null | undefined,
): SidebarGitGlyph | null {
  if (!status) {
    return null;
  }
  const conflicted = status.attention === "conflicts";
  const conflictTooltip = conflicted ? "Merge conflicts in worktree" : null;
  if (status.pr && status.pr.state !== "none") {
    return {
      kind: "pull_request",
      conflicted,
      tooltip: conflictTooltip ?? prStatusCompoundLabel(status),
    };
  }
  if (status.branch) {
    return {
      kind: "branch",
      conflicted,
      tooltip: conflictTooltip ?? status.branch,
    };
  }
  return null;
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
