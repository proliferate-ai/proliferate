import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { twMerge } from "tailwind-merge";

interface ComposerActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
  loading?: boolean;
}

export const ComposerActionButton = forwardRef<HTMLButtonElement, ComposerActionButtonProps>(
  function ComposerActionButton({
    children,
    className = "",
    type = "button",
    ...props
  }, ref) {
    return (
      <Button
        ref={ref}
        type={type}
        variant="ghost"
        size="icon-sm"
        className={twMerge(
          "size-7 rounded-full bg-[var(--color-composer-send-background)] px-0 text-[color:var(--color-composer-send-foreground)] shadow-none hover:bg-[var(--color-composer-send-background)] hover:opacity-90 disabled:cursor-default disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </Button>
    );
  },
);
