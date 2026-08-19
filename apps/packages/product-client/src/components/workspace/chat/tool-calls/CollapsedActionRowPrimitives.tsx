import type { ReactNode } from "react";
import { Button } from "#product/primitives/Button";
import { FileReferenceBadge } from "#product/components/workspace/file-references/FileReferenceBadge";

const CHAT_BUTTON_TEXT_CLASS = "text-chat";

export function PlainActionRow({
  label,
  icon,
  tone = "normal",
}: {
  label: string;
  icon: ReactNode;
  tone?: "normal" | "failed";
}) {
  return (
    <div
      title={label}
      className={`inline-flex min-w-0 max-w-full items-center gap-1.5 text-chat ${
        tone === "failed" ? "text-destructive/80" : "text-foreground/60"
      }`}
    >
      <ActionRowIcon>{icon}</ActionRowIcon>
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}

export function ActionRowIcon({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="icon-paired flex shrink-0 items-center justify-center text-current [&_svg]:size-full [&_svg]:text-current"
    >
      {children}
    </span>
  );
}

/**
 * The transcript's quiet disclosure row: a `Button variant="ghost"` with its
 * box suppressed down to a plain text affordance, which is the transcript's
 * whole interaction language.
 *
 * The suppression is deliberate and load-bearing, not a check-7 violation
 * (DESIGN_SYSTEM.md § UI-conformance review): `rounded-none bg-transparent p-0
 * hover:bg-transparent focus-visible:ring-0` is what stops a sharp-cornered
 * rectangle appearing around a transcript line on hover. Do not normalize it
 * back onto `Button`'s defaults.
 *
 * Recorded exclusion for check 1: the landed `Disclosure` is not a landing site
 * for this row. It always paints `hover:bg-hover active:bg-active` on its header
 * and exposes no suppression — `className` lands on its outer wrapper, not the
 * row — so adopting it would put back the pressed rectangle PRO-120 (#1747)
 * removes. It also renders a rotating chevron where these rows carry a status
 * glyph, and a 17px `text-heading` title where the transcript runs at 14px.
 * Landing this family needs a quiet spelling of `Disclosure`, which is a review
 * ruling, not a call-site workaround.
 */
export function ActionDisclosureRow({
  label,
  icon,
  expanded,
  failed,
  onToggle,
  trailing,
}: {
  label: string;
  icon: ReactNode;
  expanded: boolean;
  failed: boolean;
  onToggle: () => void;
  /**
   * A muted trailing status suffix (e.g. `running · 4m 12s`), shown when a
   * background command's roster data is available (bgwork r8). Absent for
   * every other row.
   */
  trailing?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-chat-transcript-ignore
      aria-expanded={expanded}
      className={`group/action-row h-auto max-w-full justify-start gap-1.5 rounded-none bg-transparent p-0 text-left ${CHAT_BUTTON_TEXT_CLASS} font-normal hover:bg-transparent active:bg-transparent focus-visible:ring-0 ${
        failed ? "text-destructive/80 hover:text-destructive" : "text-foreground/60 hover:text-foreground"
      }`}
      onClick={onToggle}
    >
      <ActionRowIcon>{icon}</ActionRowIcon>
      <span className="min-w-0 truncate">{label}</span>
      {trailing && (
        <span className="ml-auto shrink-0 text-faint">{trailing}</span>
      )}
    </Button>
  );
}

export function ActionFileLink({
  rawPath,
  workspacePath,
  displayName,
}: {
  rawPath: string;
  /** An explicitly supplied workspace-relative path; absent to classify rawPath. */
  workspacePath: string | null | undefined;
  displayName: string;
}) {
  return (
    // Keep FileReferenceBadge's semantic link color: the surrounding activity
    // row is intentionally muted, but this child is an actionable file target.
    <FileReferenceBadge
      rawPath={rawPath}
      label={displayName}
      workspacePath={workspacePath}
      variant="inline"
      className={`min-w-0 truncate !px-0 ${CHAT_BUTTON_TEXT_CLASS} !font-normal underline decoration-current decoration-dotted decoration-[0.5px] underline-offset-2 hover:decoration-dotted [&>span:first-child]:hidden`}
    />
  );
}
