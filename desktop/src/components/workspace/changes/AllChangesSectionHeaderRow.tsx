import { Button } from "@/components/ui/Button";
import { ChevronRight } from "@/components/ui/icons";

export function AllChangesSectionHeaderRow({
  label,
  count,
  collapsed,
  onToggle,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="unstyled"
      aria-expanded={!collapsed}
      onClick={onToggle}
      className="flex w-full items-center gap-2 rounded-none border-b border-border bg-background px-4 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-accent/30 hover:text-foreground"
    >
      <ChevronRight
        className={`size-3.5 shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`}
      />
      <span className="min-w-0 flex-1 truncate">
        {label} · {count}
      </span>
    </Button>
  );
}
