import { useNavigate } from "react-router-dom";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { Settings } from "@proliferate/ui/icons";

export function SidebarFooter() {
  const navigate = useNavigate();

  return (
    <div className="shrink-0">
      <div className="flex items-center justify-end gap-1 border-t !border-sidebar-border/75 px-3 py-2 shrink-0">
        <IconButton
          tone="sidebar"
          size="sm"
          onClick={() => navigate("/settings")}
          className="size-7 rounded-md border border-transparent"
        >
          <Settings className="h-4 w-4" />
          <span className="sr-only">Settings</span>
        </IconButton>
      </div>
    </div>
  );
}
