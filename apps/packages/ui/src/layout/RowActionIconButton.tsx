import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type MouseEventHandler,
  type ReactNode,
} from "react";

import { IconButton } from "../primitives/IconButton";
import { twMerge } from "../utils/tw-merge";

export type RowActionVisibility = "reveal" | "always";

export interface RowActionIconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children" | "onClick" | "title" | "type"> {
  children: ReactNode;
  label: string;
  visibility?: RowActionVisibility;
  active?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

const revealClasses =
  "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100 disabled:!pointer-events-none";

const sharedClasses =
  "size-7 !p-0 rounded-md text-ui text-muted-foreground transition-colors duration-hover hover:bg-hover hover:text-foreground active:bg-active focus-visible:text-foreground data-[state=open]:bg-active data-[active=true]:bg-active [&_svg]:icon-control";

export const RowActionIconButton = forwardRef<HTMLButtonElement, RowActionIconButtonProps>(
  function RowActionIconButton(
    {
      children,
      label,
      visibility = "reveal",
      active = false,
      className,
      disabled,
      onClick,
      ...props
    },
    ref,
  ) {
    return (
      <IconButton
        {...props}
        ref={ref}
        type="button"
        size="md"
        title={label}
        aria-label={label}
        disabled={disabled}
        data-active={active ? "true" : undefined}
        onClick={(event) => {
          event.stopPropagation();
          onClick?.(event);
        }}
        className={twMerge(
          sharedClasses,
          visibility === "reveal" ? revealClasses : "pointer-events-auto opacity-100",
          className,
        )}
      >
        {children}
      </IconButton>
    );
  },
);

export interface RowActionIndicatorProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  visibility?: RowActionVisibility;
  active?: boolean;
}

export const RowActionIndicator = forwardRef<HTMLSpanElement, RowActionIndicatorProps>(
  function RowActionIndicator(
    {
      children,
      visibility = "reveal",
      active = false,
      className,
      ...props
    },
    ref,
  ) {
    return (
      <span
        {...props}
        ref={ref}
        aria-hidden
        data-active={active ? "true" : undefined}
        className={twMerge(
          "flex size-7 items-center justify-center rounded-md text-ui text-muted-foreground transition-colors duration-hover data-[active=true]:bg-active [&_svg]:icon-control",
          visibility === "reveal"
            ? "pointer-events-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            : "pointer-events-none opacity-100",
          className,
        )}
      >
        {children}
      </span>
    );
  },
);
