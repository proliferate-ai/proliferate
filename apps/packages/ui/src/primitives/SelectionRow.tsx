import type { ReactNode } from "react";
import { Check } from "../icons/core";

interface SelectionRowProps {
  selected: boolean;
  onClick: () => void;
  icon?: ReactNode;
  label: string;
  subtitle?: string;
  disabled?: boolean;
  title?: string;
}

export function SelectionRow({
  selected,
  onClick,
  icon,
  label,
  subtitle,
  disabled = false,
  title,
}: SelectionRowProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={[
        "flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors duration-150",
        disabled
          ? "cursor-not-allowed border-border bg-transparent opacity-55"
          : selected
          ? "border-foreground/25 bg-foreground/5"
          : "border-border bg-transparent hover:bg-foreground/[0.03]",
      ].join(" ")}
    >
      {icon && <span className="flex shrink-0 items-center">{icon}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-foreground">{label}</span>
        {subtitle && (
          <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
        )}
      </span>
      <span
        className={[
          "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-150",
          selected
            ? "border-foreground bg-foreground text-background"
            : "border-border bg-transparent",
        ].join(" ")}
      >
        {selected && <Check className="size-3" />}
      </span>
    </button>
  );
}
