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
  label: string;
  detail?: string | null;
  trailing?: ReactNode;
  tone?: ComposerControlTone;
  active?: boolean;
  iconOnly?: boolean;
}

const toneClassNames: Record<ComposerControlTone, { idle: string; active: string }> = {
  neutral: { idle: "text-muted-foreground", active: "text-foreground" },
  accent: { idle: "text-muted-foreground", active: "text-foreground" },
  primary: { idle: "text-muted-foreground", active: "text-foreground" },
  warning: { idle: "text-muted-foreground", active: "text-foreground" },
  destructive: { idle: "text-muted-foreground", active: "text-foreground" },
  success: { idle: "text-muted-foreground", active: "text-foreground" },
  info: { idle: "text-muted-foreground", active: "text-foreground" },
  quiet: { idle: "text-muted-foreground", active: "text-muted-foreground" },
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
    className = "",
    type = "button",
    ...props
  }, ref) {
    const classes = active ? toneClassNames[tone].active : toneClassNames[tone].idle;
    const baseClassName = `gap-1 rounded-full border border-transparent bg-transparent transition-colors hover:bg-muted/60 focus:outline-none ${classes}`;
    const buttonClassName = iconOnly
      ? `h-7 w-7 shrink-0 !justify-center px-0 ${baseClassName} ${className}`
      : `h-7 min-w-0 max-w-full !justify-start px-2 py-0 text-left text-sm leading-[18px] ${baseClassName} ${className}`;

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
          <span className="sr-only">{detail ? `${label}: ${detail}` : label}</span>
        ) : (
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate text-left">{label}</span>
            {detail && (
              <span className="truncate text-left opacity-72">
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
