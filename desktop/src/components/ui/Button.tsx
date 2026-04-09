import { forwardRef, type ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "destructive" | "inverted";
type ButtonSize = "sm" | "md" | "pill" | "icon" | "icon-sm";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground font-medium hover:bg-primary/90 shadow-keystone",
  secondary:
    "border border-border bg-card text-card-foreground hover:bg-accent transition-colors",
  outline:
    "border border-input text-muted-foreground hover:bg-accent",
  ghost:
    "text-muted-foreground hover:bg-accent hover:text-foreground",
  destructive:
    "bg-destructive text-destructive-foreground font-medium hover:bg-destructive/90",
  inverted:
    "bg-foreground text-background hover:bg-foreground/80",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs rounded-md",
  md: "h-9 px-4 text-sm rounded-md",
  icon: "h-8 w-8 rounded-md",
  pill: "h-auto px-2.5 py-0.5 text-sm rounded-full",
  "icon-sm": "h-7 w-7 rounded-full px-0",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({
    variant = "primary",
    size = "sm",
    loading = false,
    disabled,
    className = "",
    children,
    ...props
  }, ref) {
    const base =
      "inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none";

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`${base} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...props}
      >
        {loading && (
          <svg
            className="size-3 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-6.22-8.56" />
          </svg>
        )}
        {children}
      </button>
    );
  },
);
