import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Button } from "../primitives/Button";

interface ComposerControlButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon?: ReactNode;
  label: ReactNode;
  detail?: ReactNode | null;
  trailing?: ReactNode;
  active?: boolean;
  iconOnly?: boolean;
  /**
   * Two-tone value hierarchy: renders the label (the pill's value text) in the
   * active control color while icon, detail, and trailing affordances stay in
   * the muted control colors.
   */
  emphasizeLabel?: boolean;
  labelClassName?: string;
  detailClassName?: string;
}

export const ComposerControlButton = forwardRef<HTMLButtonElement, ComposerControlButtonProps>(
  function ComposerControlButton({
    icon,
    label,
    detail = null,
    trailing,
    active = false,
    iconOnly = false,
    emphasizeLabel = false,
    labelClassName = "",
    detailClassName = "",
    className = "",
    type = "button",
    ...props
  }, ref) {
    const classes = active
      ? "text-composer-control-active-foreground"
      : "text-composer-control-foreground";
    // [CHAT-02]: hover is 7.8% (--color-hover) and the press is 5.2%
    // (--color-active). Codex's literal
    // control press is bg-token-foreground/15, but D-V2-4 ruled the ledger
    // vocabulary wins over that one value — see ui-foundation-chat-addendum.md
    // [CHAT-02], flagged item 4. Press was previously absent entirely, so the
    // control had no down-state at all.
    const baseClassName = `cursor-pointer disabled:cursor-default gap-1 rounded-full border border-transparent bg-transparent transition-colors hover:bg-hover hover:text-current active:bg-active focus:outline-none data-[state=open]:bg-hover ${classes}`;
    // Icon-only controls are a 28px square *floor*, not a fixed box: a
    // wide-glyph icon (e.g. a long level-bar ladder) grows the pill instead of
    // being squeezed inside it. Single-glyph icons are narrower than the floor,
    // so they still render as the same square they always did.
    const buttonClassName = iconOnly
      ? `h-7 min-w-7 shrink-0 !justify-center px-1 ${baseClassName} ${className}`
      : `h-7 min-w-0 max-w-full !justify-start px-1.5 py-0 text-left text-ui ${baseClassName} ${className}`;
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
        {icon && <span className="flex shrink-0 items-center">{icon}</span>}
        {iconOnly ? (
          <span className="sr-only">{iconOnlyLabel}</span>
        ) : (
          <span className="flex min-w-0 items-center gap-1">
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
