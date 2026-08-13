import type { CSSProperties } from "react";
import { Button } from "#product/primitives/Button";

/**
 * The tabs kit's group pill: the collapse/expand affordance that heads a run
 * of grouped tabs. `tone="filled"` paints the pill in the caller's `color`
 * (the shape a named, colored group takes); `tone="outline"` is the bordered
 * neutral pill.
 */
export function TabGroupPill({
  tone,
  label,
  color,
  width,
  isCollapsed,
  onToggle,
}: {
  tone: "filled" | "outline";
  label: string;
  color: string | null;
  width: number;
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  const style = {
    width,
    ...(tone === "filled" && color
      ? {
        backgroundColor: color,
        color: "var(--color-background)",
      }
      : {}),
  } as CSSProperties;
  const className = tone === "filled"
    ? "h-5 min-w-0 justify-center rounded-full border-0 px-1 py-0 text-ui font-semibold hover:opacity-90"
    : "h-5 min-w-0 justify-center rounded-full border border-border/70 bg-foreground/5 px-1 py-0 text-ui font-medium text-muted-foreground hover:bg-hover hover:text-foreground active:bg-active";

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
