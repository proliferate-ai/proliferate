/**
 * PR status glyph for sidebar rows.
 *
 * Clean, single-affordance design: renders a 14px `GitPullRequest` icon whose
 * COLOR carries the PR state, replacing the old dot-overlaid-on-glyph pattern.
 * State mapping (§3.3): open → success green, merged → pr-merged purple,
 * closed/checks_failing → destructive red, draft → muted-foreground,
 * pending → subtle muted with hollow ring, changes_requested → warning.
 * Checks failing/conflicts/changes_requested escalate to destructive/warning.
 *
 * The tooltip answers everything: "PR #805 · Open · Checks failing · approved".
 * Consistent 14px sizing; perfect vertical alignment; no layout shift between states.
 */
import type { ReactNode } from "react";
import { twMerge } from "@proliferate/ui/utils/tw-merge";

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

export const PR_STATUS_TONE: Record<PrStatusKind, string> = {
  open: "text-success",
  checks_failing: "text-destructive",
  pending: "text-muted-foreground",
  changes_requested: "text-warning",
  draft: "text-muted-foreground",
  merged: "text-pr-merged",
  closed: "text-destructive",
};

const PR_STATUS_LABEL: Record<PrStatusKind, string> = {
  open: "Open",
  checks_failing: "Checks failing",
  pending: "Checks pending",
  changes_requested: "Changes requested",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
};

export function prStatusTooltip(status: PrStatusView): string {
  if (status.label) {
    return status.label;
  }
  const state = PR_STATUS_LABEL[status.kind];
  return typeof status.number === "number"
    ? `PR #${status.number} · ${state}`
    : `PR · ${state}`;
}

/**
 * Standalone dot for workspaces page rows (kept for compatibility).
 * New sidebar rows use the colored glyph pattern via `PrStatusIconOverlay`.
 */
export function PrStatusDot({
  status,
  className = "",
  withNativeTitle = true,
}: {
  status: PrStatusView;
  className?: string;
  /**
   * Pass `false` when a wrapping `Tooltip` primitive already carries the
   * label — avoids a double tooltip (native + custom).
   */
  withNativeTitle?: boolean;
}) {
  const tooltip = prStatusTooltip(status);
  const dotTone = status.kind === "open"
    ? "bg-success"
    : status.kind === "checks_failing" || status.kind === "closed"
      ? "bg-destructive"
      : status.kind === "pending"
        ? "border border-warning-foreground bg-transparent"
        : status.kind === "changes_requested"
          ? "bg-warning-foreground"
          : status.kind === "draft"
            ? "bg-muted-foreground"
            : "bg-pr-merged";

  return (
    <span
      role="img"
      aria-label={tooltip}
      title={withNativeTitle ? tooltip : undefined}
      className={twMerge(
        "inline-block size-1.5 shrink-0 rounded-full",
        dotTone,
        className,
      )}
    />
  );
}

/**
 * Renders the PR status as a colored icon (children) whose color conveys state.
 * Returns children unchanged when no status is present. The icon color matches
 * the PR state: success for open, pr-merged purple for merged, destructive for
 * closed/failing, etc. Tooltip carries the full PR status compound label.
 */
export function PrStatusIconOverlay({
  status,
  children,
  className = "",
}: {
  status: PrStatusView | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  if (!status) {
    return <>{children}</>;
  }
  return (
    <span
      role="img"
      aria-label={prStatusTooltip(status)}
      title={prStatusTooltip(status)}
      className={twMerge(
        "inline-flex items-center justify-center",
        PR_STATUS_TONE[status.kind],
        status.kind === "pending" ? "relative" : "",
        className,
      )}
    >
      {children}
      {status.kind === "pending" ? (
        <span className="absolute inset-0 rounded-full border border-current opacity-40" aria-hidden="true" />
      ) : null}
    </span>
  );
}
