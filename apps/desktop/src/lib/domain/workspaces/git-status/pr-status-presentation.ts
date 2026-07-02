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
  /** attention === "conflicts" — render destructive tone. */
  conflicted: boolean;
  /** Tooltip content; null renders the glyph without a tooltip. */
  tooltip: string | null;
}

/**
 * Leading-well PR glyph for sidebar rows (§3.2): rendered ONLY when the row
 * has a real PR (open/draft/merged/closed). No PR (authoritative "none") and
 * unknown PR data (`pr: null`) both leave the well empty — there is no
 * branch-glyph fallback. Conflict attention keeps the destructive tone on PR
 * rows; conflicted rows WITHOUT a PR get no leading glyph — attention there
 * surfaces via the right-slot affordances (status indicator / unread dot),
 * not a leading icon.
 */
export function sidebarGitGlyphForStatus(
  status: WorkspaceGitStatus | null | undefined,
): SidebarGitGlyph | null {
  if (!status?.pr || status.pr.state === "none") {
    return null;
  }
  const conflicted = status.attention === "conflicts";
  return {
    conflicted,
    tooltip: conflicted ? "Merge conflicts in worktree" : prStatusCompoundLabel(status),
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
