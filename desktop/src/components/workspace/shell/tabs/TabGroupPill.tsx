import type { CSSProperties } from "react";
import { Button } from "@/components/ui/Button";

export function TabGroupPill({
  label,
  color,
  width,
  isCollapsed,
  onToggle,
}: {
  label: string;
  color: string;
  width: number;
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  const style = {
    width,
    backgroundColor: color,
    color: "var(--color-background)",
  } as CSSProperties;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-expanded={!isCollapsed}
      aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${label}`}
      data-telemetry-mask="true"
      onClick={onToggle}
      className="h-5 min-w-0 justify-center rounded-full border-0 px-1 py-0 text-[10px] font-semibold leading-[13px] hover:opacity-90"
      style={style}
    >
      <span className="min-w-0 truncate text-left">
        {label}
      </span>
    </Button>
  );
}
