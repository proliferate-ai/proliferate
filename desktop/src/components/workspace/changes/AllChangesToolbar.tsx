import { Button } from "@/components/ui/Button";
import { RefreshCw, SplitPanel } from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/Tooltip";

export function AllChangesToolbar({
  changedFileCount,
  layout,
  onRefresh,
  onToggleLayout,
  onToggleWrap,
  subtitle,
  title,
}: {
  changedFileCount: number;
  layout: "unified" | "split";
  onRefresh: () => void;
  onToggleLayout: () => void;
  onToggleWrap: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-sidebar-border bg-sidebar-background px-2 text-sidebar-foreground">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-[450] leading-4 text-sidebar-foreground">
          {title}
        </p>
        <p className="text-xs leading-3 text-sidebar-muted-foreground">
          {subtitle} · {changedFileCount} file{changedFileCount === 1 ? "" : "s"}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onToggleWrap}
        className="h-6 px-1.5 text-xs text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
      >
        Wrap
      </Button>
      <Tooltip content={layout === "split" ? "Unified diff" : "Split diff"}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onToggleLayout}
          aria-label="Toggle diff layout"
          className="size-6 text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <SplitPanel className="size-3" />
        </Button>
      </Tooltip>
      <Tooltip content="Refresh changes">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRefresh}
          aria-label="Refresh changes"
          className="size-6 text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <RefreshCw className="size-3" />
        </Button>
      </Tooltip>
    </div>
  );
}
