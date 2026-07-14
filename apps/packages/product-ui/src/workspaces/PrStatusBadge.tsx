/**
 * PR status rendered as a codex-style dot (UX spec §2/§3).
 *
 * The dot is 6px, colored per PR state, and carries a tooltip with the PR
 * number + state. Two render modes:
 *  - `PrStatusDot` — standalone dot (workspaces page rows, after branch name)
 *  - `PrStatusIconOverlay` — wraps a row icon and anchors the dot on its
 *    bottom-right corner (web sidebar rows; the desktop sidebar renders
 *    PR state via SidebarWorkspaceGitGlyph instead), mirroring codex's
 *    `--pr-status-dot-color` circle-on-icon pattern.
 *
 * Tone rules (spec §3.3): every dot tone is an OPAQUE color — no alpha
 * tokens. open → `success`, checks failing / closed → `destructive`,
 * pending → HOLLOW `warning-foreground` ring (the solid warning hue, since
 * `warning` itself is a low-alpha surface tint), changes requested →
 * filled `warning-foreground`, draft → `muted-foreground`, merged →
 * `pr-merged` (GitHub-convention purple; never `info`, which is the unread
 * color). Cross-app tokens, so the component works on desktop and web.
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

const PR_STATUS_TONE: Record<PrStatusKind, string> = {
  open: "bg-success",
  checks_failing: "bg-destructive",
  // Hollow: pending is the only in-flight state — an outline, not a fill.
  pending: "border border-warning-foreground bg-transparent",
  changes_requested: "bg-warning-foreground",
  draft: "bg-muted-foreground",
  merged: "bg-pr-merged",
  closed: "bg-destructive",
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
  return (
    <span
      role="img"
      aria-label={tooltip}
      title={withNativeTitle ? tooltip : undefined}
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
 * Renders children unchanged when no status is present. The dot sits fully
 * off the 14px glyph's strokes as a bare opaque dot — no ring halo, which
 * reads wrong on hovered/active alpha-overlay rows.
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
        withNativeTitle={false}
        className="absolute -bottom-px -right-px"
      />
    </span>
  );
}
