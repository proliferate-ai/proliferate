import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Button } from "#product/primitives/Button";

interface ComposerControlButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon?: ReactNode;
  label: ReactNode;
  detail?: ReactNode | null;
  trailing?: ReactNode;
  active?: boolean;
  iconOnly?: boolean;
  /**
   * Control tier. `compact` is the composer's own 24px chip grammar (labeled
   * chips: Fast, the effort stepper, the goal button); `default` stays the
   * 28px pill every other surface — and the composer's own model pill and
   * icon-only utilities — already draws.
   */
  size?: "default" | "compact";
  /**
   * Two-tone value hierarchy: renders the label (the pill's value text) in the
   * active control color while icon, detail, and trailing affordances stay in
   * the muted control colors.
   */
  emphasizeLabel?: boolean;
  labelClassName?: string;
  detailClassName?: string;
  /**
   * Classes on the wrapper spans, for width-conditional variants that must
   * remove the whole flex item (`hidden` on the inner content alone would
   * leave a zero-width item that still claims a flex gap).
   */
  iconWrapperClassName?: string;
  labelWrapperClassName?: string;
}

export const ComposerControlButton = forwardRef<HTMLButtonElement, ComposerControlButtonProps>(
  function ComposerControlButton({
    icon,
    label,
    detail = null,
    trailing,
    active = false,
    iconOnly = false,
    size = "default",
    emphasizeLabel = false,
    labelClassName = "",
    detailClassName = "",
    iconWrapperClassName = "",
    labelWrapperClassName = "",
    className = "",
    type = "button",
    ...props
  }, ref) {
    const classes = active
      ? "text-composer-control-active-foreground"
      : "text-composer-control-foreground";
    // [CHAT-02]: hover is 7.8% (--color-hover) and the press is 5.2%
    // (--color-active). The escalation's reference target was a literal 15%
    // foreground press, but D-V2-4 ruled the ledger vocabulary wins over that
    // one value — see ui-foundation-chat-addendum.md [CHAT-02], flagged item 4.
    // Press was previously absent entirely, so the control had no down-state
    // at all.
    const baseClassName = `cursor-pointer disabled:cursor-default gap-1 rounded-full border border-transparent bg-transparent transition-colors hover:bg-hover hover:text-current active:bg-active focus:outline-none data-[state=open]:bg-hover ${classes}`;
    // Icon-only controls are a square *floor*, not a fixed box: a wide-glyph
    // icon (e.g. a long level-bar ladder) grows the pill instead of being
    // squeezed inside it. Single-glyph icons are narrower than the floor, so
    // they still render as the same square they always did.
    const compact = size === "compact";
    const sizeClassName = iconOnly
      ? compact
        ? "h-6 min-w-6 shrink-0 !justify-center px-1"
        : "h-7 min-w-7 shrink-0 !justify-center px-1"
      : compact
        ? "h-6 min-w-0 max-w-full !justify-start px-[9px] py-0 text-left text-ui font-medium"
        : "h-7 min-w-0 max-w-full !justify-start px-1.5 py-0 text-left text-ui";
    const buttonClassName = `${sizeClassName} ${baseClassName} ${className}`;
    const iconOnlyLabel = typeof label === "string"
      ? label
      : typeof props["aria-label"] === "string"
        ? props["aria-label"]
        : "Composer control";

    return (
      <Button
        ref={ref}
        type={type}
        variant="ghost"
        size="sm"
        className={buttonClassName}
        {...props}
      >
        {/* flex, not inline: an inline wrapper baseline-aligns inline-flex
            icons (e.g. the level bars) instead of letting the button's
            items-center actually center them. */}
        {icon && <span className={`flex shrink-0 items-center ${iconWrapperClassName}`}>{icon}</span>}
        {iconOnly ? (
          <span className="sr-only">{iconOnlyLabel}</span>
        ) : (
          <span className={`flex min-w-0 items-center gap-1 ${labelWrapperClassName}`}>
            <span
              className={`min-w-0 truncate text-left ${
                emphasizeLabel ? "text-composer-control-active-foreground" : ""
              } ${labelClassName}`}
            >
              {label}
            </span>
            {detail && (
              <span className={`flex min-w-0 items-center gap-1 truncate text-left text-composer-control-muted-foreground ${detailClassName}`}>
                <span aria-hidden="true" className="shrink-0">·</span>
                <span className="min-w-0 truncate">{detail}</span>
              </span>
            )}
          </span>
        )}
        {trailing && <span className="ml-auto shrink-0">{trailing}</span>}
      </Button>
    );
  },
);
