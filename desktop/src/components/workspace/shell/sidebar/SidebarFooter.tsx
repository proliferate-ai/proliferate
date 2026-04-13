import { useNavigate } from "react-router-dom";
import { Settings } from "@/components/ui/icons";
import { SidebarActionButton } from "./SidebarActionButton";

export function SidebarFooter() {
  const navigate = useNavigate();

  return (
    <div className="shrink-0">
      <div className="flex items-center justify-end gap-1 border-t !border-sidebar-border/75 px-3 py-2 shrink-0">
        <SidebarActionButton
          title="Settings"
          onClick={() => navigate("/settings")}
          alwaysVisible
          className="size-7 rounded-md"
        >
          <Settings className="h-4 w-4" />
        </SidebarActionButton>
      </div>
    </div>
  );
}
