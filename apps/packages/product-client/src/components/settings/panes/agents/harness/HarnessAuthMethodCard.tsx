import type { ReactNode } from "react";
import { Check } from "#product/primitives/icons/core";
import { Button } from "#product/primitives/Button";
import { IconTile } from "#product/primitives/IconTile";

export interface MethodCardProps {
  label: string;
  description: string;
  icon: ReactNode;
  selected: boolean;
  disabled?: boolean;
  /** Rendered under the card when disabled (e.g. gateway enrollment failure). */
  subtitle?: string;
  /**
   * Rendered under the card whatever its enabled state — a fact the runtime
   * reports about this method (the native row's `detected`), not a reason it
   * cannot be picked.
   */
  note?: string;
  /** Qualification testid value (`data-harness-route-option="<kind>:<method>"`). */
  routeOptionId?: string;
  onClick: () => void;
}

/**
 * One auth-method choice as a card (design-handoff v2): 32px
 * icon tile pinned top, label + one-line rationale bottom, check icon top-right
 * when selected. The cards are a radio by behavior, not by markup:
 * `handleSingleSourceSelect` drops the other sources on every pick
 * (selection_rules.py's SINGLE_SOURCE_HARNESSES), so the control writes exactly
 * one enabled source. `aria-pressed` is retained deliberately — the
 * qualification DOM (tests/release/.../chat-authroute.ts) and the pane's own
 * suite both read it as the selected-route signal.
 *
 * Its own module: the card is pure presentation over its props, while
 * HarnessAuthSection is the chooser's state and write path — and that file sits
 * at its size ratchet.
 */
export function MethodCard({
  label,
  description,
  icon,
  selected,
  disabled,
  subtitle,
  note,
  routeOptionId,
  onClick,
}: MethodCardProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Button
        variant="unstyled"
        size="unstyled"
        type="button"
        aria-label={label}
        aria-pressed={selected}
        disabled={disabled}
        data-harness-route-option={routeOptionId}
        className={[
          "relative flex min-h-28 w-full flex-col justify-end rounded-lg border px-4 py-3.5 text-left transition-colors",
          selected
            ? "border-foreground/20 bg-selected"
            : "border-border bg-transparent",
          disabled
            ? "pointer-events-none opacity-45"
            : selected
              ? ""
              : "hover:bg-hover",
        ].join(" ")}
        onClick={onClick}
      >
        <IconTile aria-hidden className="mb-auto">
          {icon}
        </IconTile>
        {selected ? (
          // MethodCard→RadioCardGroup is deferred (frozen spec §4.3: the
          // shipped RadioCardOption has no data-attribute passthrough, which
          // would drop data-harness-route-option below). 11px centers the
          // check glyph in the card's px-4 py-3.5 corner inset; not on the
          // 4px/2px space scale because it tracks the icon's own optical
          // center, not a layout gap.
          <Check
            aria-hidden
            className="icon-paired absolute right-[11px] top-[11px] text-foreground"
          />
        ) : null}
        <span
          className={[
            "mt-2.5 block text-ui font-medium",
            selected ? "text-foreground" : "text-muted-foreground",
          ].join(" ")}
        >
          {label}
        </span>
        <span className="block whitespace-normal text-ui-sm font-normal text-muted-foreground">
          {description}
        </span>
      </Button>
      {disabled && subtitle ? (
        <p className="text-ui-sm text-muted-foreground/65">{subtitle}</p>
      ) : null}
      {note ? (
        <p className="text-ui-sm text-muted-foreground/65" data-harness-method-note>
          {note}
        </p>
      ) : null}
    </div>
  );
}
