/**
 * PR status rendered as a dot (UX spec §2/§3).
 *
 * The dot itself is the `StatusDot` primitive; this file is the thin domain
 * seam that turns a `PrStatusView` into that primitive's two axes plus a
 * tooltip. The tone/fill mapping lives beside `PrStatusKind` in
 * [pr-status-presentation.ts](../../lib/domain/workspaces/git-status/pr-status-presentation.ts)
 * (`prStatusTone`), per the presenter-function rule in specs/DESIGN_SYSTEM.md.
 *
 * `PrStatusIconOverlay` used to live here — a `relative inline-flex` wrapper
 * anchoring the dot on a row glyph's bottom-right corner. Positioning is
 * layout, which feature code owns, so its one call site (the sidebar repo
 * row) now writes those four classes in place.
 */
import { StatusDot } from "#product/primitives/StatusDot";
import {
  prStatusTone,
  type PrStatusKind,
  type PrStatusView,
} from "#product/lib/domain/workspaces/git-status/pr-status-presentation";

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
  const { tone, fill } = prStatusTone(status.kind);
  return (
    <StatusDot
      tone={tone}
      fill={fill}
      label={tooltip}
      title={withNativeTitle ? tooltip : undefined}
      className={className}
    />
  );
}
