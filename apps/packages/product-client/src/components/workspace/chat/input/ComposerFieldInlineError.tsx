import type { ReactNode } from "react";

/**
 * An error that belongs to one composer control.
 *
 * Text, not a tinted box: the box treatment (McpElicitationInlineError) reads
 * as a panel and is right for a form that owns the whole composer, but this sits
 * inside the 28px control row next to five other controls. A line of
 * destructive text under the control it belongs to says the same thing without
 * turning the control row into a card.
 *
 * Width-capped so it wraps under its own control instead of pushing the rest of
 * the row off to the right.
 */
export function ComposerFieldInlineError({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) {
  return (
    <span
      id={id}
      role="alert"
      className="max-w-[18rem] whitespace-normal text-left text-ui-sm text-destructive"
    >
      {children}
    </span>
  );
}
