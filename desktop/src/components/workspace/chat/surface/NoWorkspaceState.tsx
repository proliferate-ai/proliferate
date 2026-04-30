import { Folder } from "@/components/ui/icons";
import { WORKSPACE_ARRIVAL_LABELS } from "@/config/workspace-arrival";
import { ChatSurfaceCard } from "./ChatSurfaceCard";

interface NoWorkspaceStateProps {
  bottomInsetPx: number;
}

export function NoWorkspaceState({ bottomInsetPx }: NoWorkspaceStateProps) {
  return (
    <ChatSurfaceCard
      badge="Workspace"
      bottomInsetPx={bottomInsetPx}
      title={WORKSPACE_ARRIVAL_LABELS.noWorkspaceTitle}
      description={WORKSPACE_ARRIVAL_LABELS.noWorkspaceBody}
      icon={<Folder className="size-6" />}
    />
  );
}
