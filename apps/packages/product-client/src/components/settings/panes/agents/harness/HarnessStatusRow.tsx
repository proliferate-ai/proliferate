import { type ReactNode } from "react";
import { RefreshCw } from "@proliferate/ui/icons";
import { Badge, type BadgeTone } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { SettingsRow } from "@proliferate/product-ui/patterns/SettingsRow";

/**
 * The ONE status row of the harness pane (agent-auth.md's pane anatomy §3 and
 * §7; model-catalog.md "Status and refresh in settings").
 *
 * "Am I authenticated" and "when was this model list last checked" are the same
 * question with the same answer shape, so they get one control instead of three
 * per-method treatments: state on the left, refresh affordance on the right,
 * hairline separators from `SettingsRow`, no card.
 *
 * Two properties the spec calls out explicitly:
 *
 * - **Saved and live state coexist.** `label` is the live observation
 *   ("Authenticated" / "Not authenticated") and `savedState` is the fact about
 *   the vault and the selection ("API key set"). A saved key whose provider
 *   rejects it therefore renders as *saved but failing* rather than as either
 *   alone — nothing here overwrites one with the other.
 * - **The row itself can be the affordance.** Passing `onClick` turns the left
 *   cluster into a button (the native row: the row that reports "not logged in"
 *   is the row a user clicks to fix it). The refresh control stays a separate
 *   button on the right, so the row never nests interactives.
 */
export interface HarnessStatusRowProps {
  /** Live state, left. Rendered as the shared `Badge` pill. */
  label: string;
  tone?: BadgeTone;
  /** Saved-vault/selection fact, rendered alongside the live state. */
  savedState?: string | null;
  /** Extra state chips (unverified seed, refreshing, last refresh failed). */
  badges?: ReactNode;
  /** Freshness / explanatory line under the state. Display-only. */
  description?: ReactNode;
  refreshLabel?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Right-side affordance rendered instead of the icon-only refresh. */
  action?: ReactNode;
  /** Makes the left cluster a button (native: refresh vs. login terminal). */
  onClick?: () => void;
  /**
   * Accessible name for that button. The visible left cluster is a badge plus
   * chips, which names the STATE rather than the action, so a row whose click
   * target is a disclosure names what it discloses.
   */
  clickLabel?: string;
  expanded?: boolean;
  /** Rendered under the row (the native choice group, a login terminal). */
  children?: ReactNode;
  "data-harness-status"?: string;
}

export function HarnessStatusRow({
  label,
  tone = "neutral",
  savedState = null,
  badges,
  description,
  refreshLabel = "Refresh status",
  refreshing = false,
  onRefresh,
  action,
  onClick,
  clickLabel,
  expanded,
  children,
  ...dataProps
}: HarnessStatusRowProps) {
  const state = (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <Badge tone={tone}>{label}</Badge>
      {savedState ? (
        <span className="text-ui-sm font-normal text-muted-foreground">{savedState}</span>
      ) : null}
      {badges}
    </span>
  );

  return (
    <div data-harness-status-row="true" {...dataProps}>
      <SettingsRow
        label={onClick ? (
          <Button
            variant="unstyled"
            size="unstyled"
            type="button"
            aria-label={clickLabel}
            aria-expanded={expanded}
            className="flex min-w-0 items-center gap-2 rounded-md text-left"
            onClick={onClick}
          >
            {state}
          </Button>
        ) : state}
        description={description}
      >
        {action}
        {onRefresh ? (
          <IconButton
            aria-label={refreshLabel}
            title={refreshLabel}
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshCw className={`icon-paired ${refreshing ? "animate-spin" : ""}`} />
          </IconButton>
        ) : null}
      </SettingsRow>
      {children}
    </div>
  );
}
