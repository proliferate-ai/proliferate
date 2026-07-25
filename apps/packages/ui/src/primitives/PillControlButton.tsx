import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { ChevronDown } from "../icons/core";
import { Button } from "./Button";

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
      <ChevronDown className="icon-paired shrink-0 text-muted-foreground" />
    ) : null
  );
  const baseClassName = iconOnly
    ? "h-7 w-7 shrink-0 rounded-full px-0 py-0 text-muted-foreground hover:bg-hover hover:text-foreground active:bg-active data-[state=open]:bg-active data-[state=open]:text-foreground"
    : "h-7 min-w-0 max-w-full justify-start gap-1 rounded-full px-2 py-0 text-ui text-muted-foreground hover:bg-hover hover:text-foreground active:bg-active data-[state=open]:bg-active data-[state=open]:text-foreground";

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
            className={`min-w-0 truncate text-foreground ${labelClassName}`}
          >
            {label}
          </span>
          {detail ? (
            <span
              className={`min-w-0 truncate text-muted-foreground ${detailClassName}`}
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
