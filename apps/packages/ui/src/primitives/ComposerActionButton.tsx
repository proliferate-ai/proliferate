import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { Button } from "./Button";

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
    // UX_SPEC §5: 28px solid circle — foreground bg / background glyph,
    // disabled at 40%.
    return (
      <Button
        ref={ref}
        type={type}
        variant="ghost"
        size="icon-sm"
        className={twMerge(
          "size-7 shrink-0 rounded-full bg-[var(--color-composer-send-background)] px-0 text-[color:var(--color-composer-send-foreground)] shadow-none hover:bg-[var(--color-composer-send-background)] hover:opacity-90 disabled:cursor-default disabled:opacity-40",
          className,
        )}
        {...props}
      >
        {children}
      </Button>
    );
  },
);
