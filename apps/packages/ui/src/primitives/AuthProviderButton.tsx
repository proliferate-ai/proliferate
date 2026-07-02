import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { twMerge } from "../utils/tw-merge";
import { Spinner } from "./Spinner";

interface AuthProviderButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  loading?: boolean;
  variant?: "primary" | "secondary";
}

export const AuthProviderButton = forwardRef<HTMLButtonElement, AuthProviderButtonProps>(
  function AuthProviderButton({
    icon,
    loading = false,
    variant = "secondary",
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
          "relative flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border px-4 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-60",
          variant === "primary"
            ? "border-transparent bg-foreground text-background hover:bg-foreground/90"
            : "border-border bg-card text-foreground hover:bg-accent",
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
