import { IconButton } from "@/components/ui/IconButton";
import { FileText, SplitPanel } from "@/components/ui/icons";

interface CoworkWorkspaceHeaderProps {
  title: string;
  subtitle?: string | null;
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  onToggleSidebar: () => void;
  onToggleRightPanel: () => void;
}

export function CoworkWorkspaceHeader({
  title,
  subtitle,
  sidebarOpen,
  rightPanelOpen,
  onToggleSidebar,
  onToggleRightPanel,
}: CoworkWorkspaceHeaderProps) {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3">
      <div className="flex min-w-0 items-center gap-2">
        {!sidebarOpen && (
          <IconButton
            size="sm"
            onClick={onToggleSidebar}
            title="Show sidebar"
            className="rounded-md"
          >
            <SplitPanel className="size-4" />
          </IconButton>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{title}</div>
          {subtitle && (
            <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <IconButton
          size="sm"
          onClick={onToggleRightPanel}
          title={rightPanelOpen ? "Hide artifacts" : "Show artifacts"}
          className={rightPanelOpen ? "bg-accent text-foreground" : "rounded-md"}
        >
          <FileText className="size-4" />
        </IconButton>
      </div>
    </div>
  );
}
