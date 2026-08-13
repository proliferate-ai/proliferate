/**
 * The status dot: a round semantic-status glyph, sized by the `icon-status`
 * appearance tier so it scales with the user's text size.
 *
 * Promoted from duplicates, not speculation. Two independent hand-rolls
 * already implement the same skeleton over different data — the PR dot in
 * [PrStatusBadge](../components/patterns/PrStatusBadge.tsx) (opaque tone map
 * plus a hollow `pending` ring) and
 * [RecentWorkStatusDot](../components/workspace/repo-setup/RecentWorkStatusDot.tsx)
 * (a `text-*` tone plus `bg-current` / `border border-current bg-transparent`)
 * — and a dozen more inline `icon-status rounded-full bg-*` spans sit in
 * settings, auth, tabs and toast surfaces. `StatusDot` is their union.
 *
 * Exactly two variant axes, and the cap is deliberate:
 *  - `tone` — which semantic status colour, from the closed set below.
 *  - `fill` — `solid` (a filled disc) or `hollow` (a ring over nothing), the
 *    "in flight / not yet settled" reading both hand-rolls already encode.
 *
 * Everything else is a prop, not an axis: `label`/`title` are accessibility
 * text, and `className` is layout (position, margin) owned by the call site.
 * A third visual axis — size, pulse, halo ring — is a redesign decision, not
 * an extension: see the variant budget in specs/DESIGN_SYSTEM.md.
 *
 * incubating: shell + workflows slices, wave 2. Today's consumer is
 * `PrStatusBadge` (workspaces command list, sidebar repo rows). The wave-2
 * slices absorb the remaining hand-rolls named above.
 */
import { twMerge } from "#product/primitives/utils/tw-merge";

export type StatusDotTone =
  /** Inherits the parent's text colour — the tone lives on the wrapper. */
  | "current"
  | "success"
  | "info"
  | "warning"
  | "danger"
  | "muted"
  /** GitHub-convention merged purple; never `info`, which reads as unread. */
  | "merged";

export type StatusDotFill = "solid" | "hollow";

/**
 * Every tone is an OPAQUE ink. `warning` maps to `warning-foreground`, not
 * `warning`: the latter is a low-alpha surface tint, and a status-sized disc
 * filled with it is invisible beside its opaque siblings.
 */
const TONE_CLASS: Record<StatusDotTone, { solid: string; hollow: string }> = {
  current: { solid: "bg-current", hollow: "border-current" },
  success: { solid: "bg-success", hollow: "border-success" },
  info: { solid: "bg-info", hollow: "border-info" },
  warning: { solid: "bg-warning-foreground", hollow: "border-warning-foreground" },
  danger: { solid: "bg-destructive", hollow: "border-destructive" },
  muted: { solid: "bg-muted-foreground", hollow: "border-muted-foreground" },
  merged: { solid: "bg-pr-merged", hollow: "border-pr-merged" },
};

export interface StatusDotProps {
  tone: StatusDotTone;
  /** Defaults to a filled disc. */
  fill?: StatusDotFill;
  /**
   * Accessible name. Given a label the dot is an `img` announcing that name;
   * without one it is decorative (`aria-hidden`) and the surrounding row is
   * expected to carry the text.
   */
  label?: string;
  /** Native `title` tooltip. Omit when a `Tooltip` already carries the text. */
  title?: string;
  /** Layout only — position, margin, flex behaviour. Never tone or size. */
  className?: string;
}

export function StatusDot({
  tone,
  fill = "solid",
  label,
  title,
  className = "",
}: StatusDotProps) {
  const toneClass = TONE_CLASS[tone];
  return (
    <span
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? "true" : undefined}
      title={title}
      className={twMerge(
        "inline-block icon-status shrink-0 rounded-full",
        fill === "hollow"
          ? `border bg-transparent ${toneClass.hollow}`
          : toneClass.solid,
        className,
      )}
    />
  );
}

/**
 * The ink half of the same seven-tone map, for call sites that tint a glyph
 * or a text run standing in for the dot rather than rendering the dot
 * itself (a roster row's leading icon, a status label). One owner for the
 * `tone -> ink` mapping keeps a glyph-based status reading and a dot-based
 * one from drifting apart.
 */
const TONE_TEXT_CLASS: Record<StatusDotTone, string> = {
  current: "text-current",
  success: "text-success",
  info: "text-info",
  warning: "text-warning-foreground",
  danger: "text-destructive",
  muted: "text-muted-foreground",
  merged: "text-pr-merged",
};

export function statusDotToneTextClass(tone: StatusDotTone): string {
  return TONE_TEXT_CLASS[tone];
}
