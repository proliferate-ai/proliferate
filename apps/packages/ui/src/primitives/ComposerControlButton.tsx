import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Button } from "./Button";

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
      ? "text-[color:var(--color-composer-control-active-foreground)]"
      : "text-[color:var(--color-composer-control-foreground)]";
    const baseClassName = `gap-1 rounded-full border border-transparent bg-transparent transition-colors hover:bg-[var(--color-composer-control-hover)] hover:text-current focus:outline-none data-[state=open]:bg-[var(--color-composer-control-hover)] ${classes}`;
    const buttonClassName = iconOnly
      ? `h-7 w-7 shrink-0 !justify-center px-0 ${baseClassName} ${className}`
      : `h-7 min-w-0 max-w-full !justify-start px-2 py-0 text-left text-ui ${baseClassName} ${className}`;
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
        {icon && <span className="shrink-0">{icon}</span>}
        {iconOnly ? (
          <span className="sr-only">{iconOnlyLabel}</span>
        ) : (
          <span className="flex min-w-0 items-center gap-1">
            <span
              className={`min-w-0 truncate text-left ${
                emphasizeLabel ? "text-[color:var(--color-composer-control-active-foreground)]" : ""
              } ${labelClassName}`}
            >
              {label}
            </span>
            {detail && (
              <span className={`flex min-w-0 items-center gap-1 truncate text-left text-[color:var(--color-composer-control-muted-foreground)] ${detailClassName}`}>
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
