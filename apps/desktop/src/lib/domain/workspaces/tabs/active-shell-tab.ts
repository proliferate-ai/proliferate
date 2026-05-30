import {
  chatWorkspaceShellTabKey,
  resolveWorkspaceShellTabFromKey,
  type WorkspaceShellIntentKey,
  type WorkspaceShellTab,
  type WorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";

interface ActiveShellTabStateSnapshot {
  activeShellTabKeyByWorkspace: Record<string, WorkspaceShellIntentKey | null>;
  urgentHighlightedChatSessionByWorkspace: Record<string, string | null>;
}

interface WorkspaceShellTabResolutionInput {
  activeShellTab: WorkspaceShellTab | null;
  activeShellTabKey: WorkspaceShellTabKey | null;
  materializedWorkspaceId: string | null;
  orderedTabs: readonly WorkspaceShellTab[];
  state: ActiveShellTabStateSnapshot;
  workspaceUiKey: string | null;
}

export function resolveActiveWorkspaceShellTab({
  activeShellTab,
  activeShellTabKey,
  materializedWorkspaceId,
  orderedTabs,
  renderedActiveChatSessionId,
  state,
  workspaceUiKey,
}: WorkspaceShellTabResolutionInput & {
  renderedActiveChatSessionId?: string | null;
}): WorkspaceShellTab | null {
  return resolveUrgentWorkspaceShellTab({
    materializedWorkspaceId,
    orderedTabs,
    state,
    workspaceUiKey,
  }) ?? (
    renderedActiveChatSessionId
      ? resolveWorkspaceShellTabFromKey(
        chatWorkspaceShellTabKey(renderedActiveChatSessionId),
        orderedTabs,
      )
      : null
  ) ?? resolveStoredWorkspaceShellTab({
    activeShellTabKey,
    materializedWorkspaceId,
    orderedTabs,
    state,
    workspaceUiKey,
  }) ?? activeShellTab;
}

export function resolveStoredWorkspaceShellTab({
  activeShellTabKey,
  materializedWorkspaceId,
  orderedTabs,
  state,
  workspaceUiKey,
}: Omit<WorkspaceShellTabResolutionInput, "activeShellTab">): WorkspaceShellTab | null {
  const storedActiveKey = (
    workspaceUiKey
      ? state.activeShellTabKeyByWorkspace[workspaceUiKey] ?? null
      : null
  ) ?? (
    materializedWorkspaceId
      ? state.activeShellTabKeyByWorkspace[materializedWorkspaceId] ?? null
      : null
  );

  return resolveWorkspaceShellTabFromKey(
    storedActiveKey ?? activeShellTabKey,
    orderedTabs,
  );
}

function resolveUrgentWorkspaceShellTab({
  materializedWorkspaceId,
  orderedTabs,
  state,
  workspaceUiKey,
}: Pick<
  WorkspaceShellTabResolutionInput,
  "materializedWorkspaceId" | "orderedTabs" | "state" | "workspaceUiKey"
>): WorkspaceShellTab | null {
  const urgentSessionId = (
    workspaceUiKey
      ? state.urgentHighlightedChatSessionByWorkspace[workspaceUiKey] ?? null
      : null
  ) ?? (
    materializedWorkspaceId
      ? state.urgentHighlightedChatSessionByWorkspace[materializedWorkspaceId] ?? null
      : null
  );

  return urgentSessionId
    ? resolveWorkspaceShellTabFromKey(chatWorkspaceShellTabKey(urgentSessionId), orderedTabs)
    : null;
}
