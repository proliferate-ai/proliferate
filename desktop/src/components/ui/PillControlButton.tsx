import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/Button";
import { ChevronDown } from "@/components/ui/icons";

interface PillControlButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon?: ReactNode;
  label: string;
  detail?: string | null;
  trailing?: ReactNode;
  disclosure?: boolean;
  iconOnly?: boolean;
  labelClassName?: string;
  detailClassName?: string;
}

export const PillControlButton = forwardRef<
  HTMLButtonElement,
  PillControlButtonProps
>(function PillControlButton(
  {
    icon,
    label,
    detail,
    trailing,
    disclosure = false,
    iconOnly = false,
    labelClassName = "",
    detailClassName = "",
    className = "",
    type = "button",
    ...props
  },
  ref,
) {
  const resolvedTrailing = trailing ?? (
    disclosure ? (
      <ChevronDown className="size-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
    ) : null
  );
  const baseClassName = iconOnly
    ? "h-7 w-7 shrink-0 rounded-full px-0 py-0 text-[color:var(--color-muted-foreground)] hover:bg-accent hover:text-[color:var(--color-foreground)] data-[state=open]:bg-accent data-[state=open]:text-[color:var(--color-foreground)]"
    : "h-7 min-w-0 max-w-full justify-start gap-1 rounded-full px-2 py-0 text-sm leading-[18px] text-[color:var(--color-muted-foreground)] hover:bg-accent hover:text-[color:var(--color-foreground)] data-[state=open]:bg-accent data-[state=open]:text-[color:var(--color-foreground)]";

  return (
    <Button
      ref={ref}
      type={type}
      variant="ghost"
      size={iconOnly ? "icon-sm" : "sm"}
      className={`${baseClassName} ${className}`}
      {...props}
    >
      {icon ? (
        <span className="flex shrink-0 items-center justify-center">
          {icon}
        </span>
      ) : null}
      {!iconOnly ? (
        <span className="flex min-w-0 items-baseline gap-1">
          <span
            className={`min-w-0 truncate text-[color:var(--color-foreground)] ${labelClassName}`}
          >
            {label}
          </span>
          {detail ? (
            <span
              className={`min-w-0 truncate text-[color:var(--color-muted-foreground)] ${detailClassName}`}
            >
              {detail}
            </span>
          ) : null}
        </span>
      ) : null}
      {resolvedTrailing ? (
        <span className="flex shrink-0 items-center justify-center">
          {resolvedTrailing}
        </span>
      ) : null}
    </Button>
  );
});
