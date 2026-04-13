import type { ReactNode } from "react";
import { ChevronDown } from "@/components/ui/icons";

interface CollapsibleSummaryRowProps {
  label: string;
  value: string;
  onClick: () => void;
  trailingIcon?: ReactNode;
}

export function CollapsibleSummaryRow({
  label,
  value,
  onClick,
  trailingIcon,
}: CollapsibleSummaryRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-lg border border-border bg-transparent px-4 py-3 text-left transition-colors duration-150 hover:bg-foreground/[0.03]"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="mt-0.5 truncate text-sm text-foreground">
          {value}
        </span>
      </span>
      {trailingIcon ?? <ChevronDown className="ml-3 size-4 shrink-0 text-muted-foreground" />}
    </button>
  );
}
