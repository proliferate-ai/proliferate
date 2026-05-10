import { Button } from "@/components/ui/Button";
import { RefreshCw } from "@/components/ui/icons";
import { SplitPanel } from "@/components/ui/workspace-icons";
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
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-4 text-foreground">
          {title}
        </p>
        <p className="text-[10px] leading-3 text-muted-foreground">
          {subtitle} · {changedFileCount} file{changedFileCount === 1 ? "" : "s"}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onToggleWrap}
        className="h-7 px-2 text-xs"
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
          className="size-7"
        >
          <SplitPanel className="size-3.5" />
        </Button>
      </Tooltip>
      <Tooltip content="Refresh changes">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRefresh}
          aria-label="Refresh changes"
          className="size-7"
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </Tooltip>
    </div>
  );
}
