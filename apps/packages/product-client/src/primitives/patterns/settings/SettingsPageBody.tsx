import { type HTMLAttributes, type ReactNode } from "react";

export interface SettingsPageBodyProps
  extends Omit<HTMLAttributes<HTMLElement>, "className" | "children"> {
  children?: ReactNode;
}

/**
 * The settings area scaffold: the body of one settings pane.
 *
 * Owns the two things every settings pane currently hand-rolls at its root —
 * the page-width contract and the vertical rhythm between top-level sections —
 * so sibling panes cannot drift apart. This is check 8 of the UI-conformance
 * review made structural: rhythm is anatomy, containers own the space between
 * their children, and the area scaffold owns the section gap the way
 * `SettingsGroup` owns its hairline dividers.
 *
 * The rhythm is deliberately not overridable. There is no `className` prop: a
 * pane that could pass `space-y-3` is a pane that can drift, which is the exact
 * failure this scaffold exists to prevent. Remaining `HTMLElement` attributes
 * (`data-*`, `aria-*`, `id`) still pass through for panes that key test hooks
 * off their root.
 *
 * Values transcribed from the surveyed panes, not invented: `max-w-[50rem]` is
 * the settings page-width contract, formerly on `SettingsScreen`'s centering
 * container and handed off to the panes here,
 * and `space-y-6` is the root rhythm of 22 of the 26 surveyed pane roots.
 */
export function SettingsPageBody({ children, ...props }: SettingsPageBodyProps) {
  return (
    <section className="w-full max-w-[50rem] space-y-6" {...props}>
      {children}
    </section>
  );
}
