import type { SessionViewState } from "@/lib/domain/sessions/activity";
import type { DelegatedWorkTabIdentity } from "@/lib/domain/delegated-work/model";
import type { GroupedChatTab } from "@/lib/domain/workspaces/tabs/grouping";
import type { HeaderStripRow } from "@/lib/domain/workspaces/tabs/group-rows";
import type { ManualChatGroupId } from "@/lib/domain/workspaces/tabs/manual-groups";
import type { HeaderShellStripRow } from "@/lib/domain/workspaces/tabs/shell-rows";

export interface HeaderChatTabEntry extends GroupedChatTab {
  id: string;
  title: string;
  agentKind: string;
  viewState: SessionViewState;
  canFork: boolean;
  isReviewAgentChild: boolean;
  source: "subagent" | "review" | "cowork" | null;
  sessionLinkId: string | null;
  workspaceId: string | null;
  isActive: boolean;
  hasUnreadActivity: boolean;
  groupColor: string | null;
  visualGroupId: string | null;
  manualGroupId: ManualChatGroupId | null;
  isHierarchyResolved: boolean;
  isResolvingSession: boolean;
  delegatedAgent: DelegatedWorkTabIdentity | null;
}

export interface HeaderChatMenuEntry {
  id: string;
  title: string;
  agentKind: string;
  viewState: SessionViewState;
  isResolvingSession: boolean;
  hasUnreadActivity: boolean;
  isActive: boolean;
  isVisible: boolean;
}

export type HeaderChatStripRow = HeaderStripRow<HeaderChatTabEntry>;
export type HeaderWorkspaceShellStripRow = HeaderShellStripRow<HeaderChatTabEntry>;
