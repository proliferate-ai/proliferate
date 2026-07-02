import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { twMerge } from "../utils/tw-merge";

interface ListRowProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
}

export const ListRow = forwardRef<HTMLButtonElement, ListRowProps>(
  function ListRow({
    title,
    description,
    leading,
    trailing,
    className = "",
    type = "button",
    ...props
  }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={twMerge(
          "flex w-full items-center gap-3 border-b border-border-light px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent disabled:pointer-events-none disabled:opacity-60",
          className,
        )}
        {...props}
      >
        {leading && <span className="flex size-8 shrink-0 items-center justify-center">{leading}</span>}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{title}</span>
          {description && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span>}
        </span>
        {trailing && <span className="shrink-0">{trailing}</span>}
      </button>
    );
  },
);
