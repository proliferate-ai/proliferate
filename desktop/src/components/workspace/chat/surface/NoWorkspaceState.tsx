import { Folder } from "@/components/ui/icons";
import { WORKSPACE_ARRIVAL_LABELS } from "@/config/workspace-arrival";
import { ChatSurfaceCard } from "./ChatSurfaceCard";

export function NoWorkspaceState() {
  return (
    <ChatSurfaceCard
      badge="Workspace"
      title={WORKSPACE_ARRIVAL_LABELS.noWorkspaceTitle}
      description={WORKSPACE_ARRIVAL_LABELS.noWorkspaceBody}
      icon={<Folder className="size-6" />}
    />
  );
}
