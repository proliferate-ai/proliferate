import { Folder } from "@proliferate/ui/icons";
import { WORKSPACE_ARRIVAL_LABELS } from "#product/copy/workspaces/workspace-arrival-copy";
import { ChatSurfaceCard } from "#product/components/workspace/chat/surface/ChatSurfaceCard";

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
      icon={<Folder className="icon-display" />}
    />
  );
}
