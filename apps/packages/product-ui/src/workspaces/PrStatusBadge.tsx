/**
 * PR status rendered as a codex-style dot (UX spec §2/§3).
 *
 * The dot is 6px, colored per PR state, and carries a tooltip with the PR
 * number + state. Two render modes:
 *  - `PrStatusDot` — standalone dot (workspaces page rows, after branch name)
 *  - `PrStatusIconOverlay` — wraps a row icon and anchors the dot on its
 *    bottom-right corner (sidebar workspace rows), mirroring codex's
 *    `--pr-status-dot-color` circle-on-icon pattern.
 *
 * Color map (spec §2): open → green, checks failing → red, pending → yellow,
 * draft → faint, merged → special/blue. Uses cross-app tokens (`success` =
 * `--diff-add` value, `destructive` = `--danger`, `warning`, `faint`, `info`)
 * so the component works on both desktop and web surfaces.
 */
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

export type PrStatusKind =
  | "open"
  | "checks_failing"
  | "pending"
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

const PR_STATUS_TONE: Record<PrStatusKind, string> = {
  open: "bg-success",
  checks_failing: "bg-destructive",
  pending: "bg-warning",
  draft: "bg-faint",
  merged: "bg-info",
  closed: "bg-destructive",
};

const PR_STATUS_LABEL: Record<PrStatusKind, string> = {
  open: "Open",
  checks_failing: "Checks failing",
  pending: "Checks pending",
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

export function PrStatusDot({
  status,
  className = "",
}: {
  status: PrStatusView;
  className?: string;
}) {
  const tooltip = prStatusTooltip(status);
  return (
    <span
      role="img"
      aria-label={tooltip}
      title={tooltip}
      className={twMerge(
        "inline-block size-1.5 shrink-0 rounded-full",
        PR_STATUS_TONE[status.kind],
        className,
      )}
    />
  );
}

/**
 * Anchors the PR dot on the bottom-right of a row icon (codex dot-on-icon).
 * Renders children unchanged when no status is present.
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
    <span className={twMerge("relative inline-flex items-center justify-center", className)}>
      {children}
      <PrStatusDot
        status={status}
        className="absolute -bottom-0.5 -right-0.5 ring-2 ring-sidebar"
      />
    </span>
  );
}
