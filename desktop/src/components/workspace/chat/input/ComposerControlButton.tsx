import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";

export type ComposerControlTone =
  | "neutral"
  | "accent"
  | "primary"
  | "warning"
  | "destructive"
  | "success"
  | "info"
  | "quiet";

interface ComposerControlButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon?: ReactNode;
  label: ReactNode;
  detail?: ReactNode | null;
  trailing?: ReactNode;
  tone?: ComposerControlTone;
  active?: boolean;
  iconOnly?: boolean;
  labelClassName?: string;
  detailClassName?: string;
}

const toneClassNames: Record<ComposerControlTone, { idle: string; active: string }> = {
  neutral: {
    idle: "text-[color:var(--color-composer-control-foreground)]",
    active: "text-[color:var(--color-composer-control-active-foreground)]",
  },
  accent: {
    idle: "text-[color:var(--color-composer-control-foreground)]",
    active: "text-[color:var(--color-composer-control-active-foreground)]",
  },
  primary: {
    idle: "text-[color:var(--color-composer-control-foreground)]",
    active: "text-[color:var(--color-composer-control-active-foreground)]",
  },
  warning: {
    idle: "text-[color:var(--color-composer-control-foreground)]",
    active: "text-[color:var(--color-composer-control-active-foreground)]",
  },
  destructive: {
    idle: "text-[color:var(--color-composer-control-foreground)]",
    active: "text-[color:var(--color-composer-control-active-foreground)]",
  },
  success: {
    idle: "text-[color:var(--color-composer-control-foreground)]",
    active: "text-[color:var(--color-composer-control-active-foreground)]",
  },
  info: {
    idle: "text-[color:var(--color-composer-control-foreground)]",
    active: "text-[color:var(--color-composer-control-active-foreground)]",
  },
  quiet: {
    idle: "text-[color:var(--color-composer-control-foreground)]",
    active: "text-[color:var(--color-composer-control-foreground)]",
  },
};

export const ComposerControlButton = forwardRef<HTMLButtonElement, ComposerControlButtonProps>(
  function ComposerControlButton({
    icon,
    label,
    detail = null,
    trailing,
    tone = "neutral",
    active = false,
    iconOnly = false,
    labelClassName = "",
    detailClassName = "",
    className = "",
    type = "button",
    ...props
  }, ref) {
    const classes = active ? toneClassNames[tone].active : toneClassNames[tone].idle;
    const baseClassName = `gap-1 rounded-full border border-transparent bg-transparent transition-colors hover:bg-[var(--color-composer-control-hover)] hover:text-current focus:outline-none data-[state=open]:bg-[var(--color-composer-control-hover)] ${classes}`;
    const buttonClassName = iconOnly
      ? `h-7 w-7 shrink-0 !justify-center px-0 ${baseClassName} ${className}`
      : `h-7 min-w-0 max-w-full !justify-start px-2 py-0 text-left text-sm leading-[18px] ${baseClassName} ${className}`;
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
            <span className={`min-w-0 truncate text-left ${labelClassName}`}>{label}</span>
            {detail && (
              <span className={`truncate text-left text-[color:var(--color-composer-control-muted-foreground)] ${detailClassName}`}>
                {detail}
              </span>
            )}
          </span>
        )}
        {trailing && <span className="ml-auto shrink-0">{trailing}</span>}
      </Button>
    );
  },
);
