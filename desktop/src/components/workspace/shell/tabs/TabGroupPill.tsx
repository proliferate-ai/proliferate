import type { CSSProperties } from "react";
import { Button } from "@/components/ui/Button";

export function TabGroupPill({
  groupKind,
  label,
  color,
  width,
  isCollapsed,
  onToggle,
}: {
  groupKind: "manual" | "subagent";
  label: string;
  color: string | null;
  width: number;
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  const style = {
    width,
    ...(groupKind === "manual" && color
      ? {
        backgroundColor: color,
        color: "var(--color-background)",
      }
      : {}),
  } as CSSProperties;
  const className = groupKind === "manual"
    ? "h-5 min-w-0 justify-center rounded-full border-0 px-1 py-0 text-[10px] font-semibold leading-[13px] hover:opacity-90"
    : "h-5 min-w-0 justify-center rounded-full border border-border/70 bg-foreground/5 px-1 py-0 text-[10px] font-medium leading-[13px] text-muted-foreground hover:bg-foreground/8 hover:text-foreground";

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-expanded={!isCollapsed}
      aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${label}`}
      data-telemetry-mask="true"
      onClick={onToggle}
      className={className}
      style={style}
    >
      <span className="min-w-0 truncate text-left">
        {label}
      </span>
    </Button>
  );
}
