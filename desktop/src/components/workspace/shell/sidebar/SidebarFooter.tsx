import { useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Settings, CircleQuestion } from "@/components/ui/icons";
import { SupportPopover } from "@/components/support/SupportPopover";
import { humanizeBranchName } from "@/lib/domain/workspaces/branch-naming";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { isCloudWorkspaceId } from "@/lib/domain/workspaces/cloud-ids";
import { workspaceDisplayName } from "@/lib/domain/workspaces/workspace-display";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { SidebarActionButton } from "./SidebarActionButton";

export function SidebarFooter() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: workspaceCollections } = useWorkspaces();
  const selectedWorkspaceId = useHarnessStore((s) => s.selectedWorkspaceId);
  const [supportOpen, setSupportOpen] = useState(false);
  const supportButtonRef = useRef<HTMLButtonElement>(null);

  const supportContext = useMemo(() => {
    const pathname = `${location.pathname}${location.search}`;
    const localWorkspaces = workspaceCollections?.workspaces ?? [];
    const cloudWorkspaces = workspaceCollections?.cloudWorkspaces ?? [];

    if (!selectedWorkspaceId) {
      return {
        source: "sidebar" as const,
        intent: "general" as const,
        pathname,
      };
    }

    if (isCloudWorkspaceId(selectedWorkspaceId)) {
      const cloudId = selectedWorkspaceId.slice("cloud:".length);
      const workspace = cloudWorkspaces.find((entry) => entry.id === cloudId);
      return {
        source: "sidebar" as const,
        intent: "general" as const,
        pathname,
        workspaceId: selectedWorkspaceId,
        workspaceName: workspace?.repo.branch
          ? humanizeBranchName(workspace.repo.branch)
          : workspace?.repo.name,
        workspaceLocation: "cloud" as const,
      };
    }

    const workspace = localWorkspaces.find((entry) => entry.id === selectedWorkspaceId);
    return {
      source: "sidebar" as const,
      intent: "general" as const,
      pathname,
      workspaceId: selectedWorkspaceId,
      workspaceName: workspace
        ? workspaceDisplayName(workspace)
        : undefined,
      workspaceLocation: "local" as const,
    };
  }, [location.pathname, location.search, selectedWorkspaceId, workspaceCollections]);

  return (
    <div className="relative shrink-0">
      {supportOpen && (
        <SupportPopover
          context={supportContext}
          triggerRef={supportButtonRef}
          onClose={() => setSupportOpen(false)}
        />
      )}
      <div className="flex items-center justify-between gap-1 border-t !border-sidebar-border/75 px-3 py-2 shrink-0">
        <SidebarActionButton
          ref={supportButtonRef}
          title="Contact support"
          onClick={() => setSupportOpen((current) => !current)}
          alwaysVisible
          className="size-7 rounded-md"
        >
          <CircleQuestion className="h-4 w-4" />
        </SidebarActionButton>
        <div className="flex items-center gap-2">
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
    </div>
  );
}
