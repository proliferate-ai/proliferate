import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { Spinner } from "../primitives/Spinner";

interface AuthProviderButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  loading?: boolean;
}

export const AuthProviderButton = forwardRef<HTMLButtonElement, AuthProviderButtonProps>(
  function AuthProviderButton({
    icon,
    loading = false,
    disabled,
    className = "",
    children,
    type = "button",
    ...props
  }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={twMerge(
          "relative flex h-14 w-full items-center justify-center gap-3 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-60",
          className,
        )}
        {...props}
      >
        <span className="flex size-5 shrink-0 items-center justify-center">
          {loading ? <Spinner className="size-4" /> : icon}
        </span>
        <span>{children}</span>
      </button>
    );
  },
);
