import { forwardRef, type MouseEventHandler, type ReactNode } from "react";

type IconButtonTone = "default" | "sidebar";
type IconButtonSize = "sm" | "md";

interface IconButtonProps {
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
  title: string;
  tone?: IconButtonTone;
  size?: IconButtonSize;
  disabled?: boolean;
}

const toneClasses: Record<IconButtonTone, string> = {
  default: "text-muted-foreground hover:bg-accent hover:text-foreground",
  sidebar:
    "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
};

const sizeClasses: Record<IconButtonSize, string> = {
  sm: "size-6",
  md: "size-7",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      children,
      onClick,
      className = "",
      title,
      tone = "default",
      size = "sm",
      disabled = false,
    },
    ref,
  ) {
    const base =
      "inline-flex px-2 items-center gap-2 whitespace-nowrap font-[450] text-xs justify-center rounded-md border border-transparent ring-offset-background focus-visible:outline-none focus-visible:ring-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 transition-colors";

    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        title={title}
        aria-label={title}
        disabled={disabled}
        className={`${base} ${sizeClasses[size]} ${toneClasses[tone]} ${className}`}
      >
        {children}
      </button>
    );
  },
);
