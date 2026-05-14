import type { SessionViewState } from "@/lib/domain/sessions/activity";
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
  isActive: boolean;
  groupColor: string | null;
  visualGroupId: string | null;
  manualGroupId: ManualChatGroupId | null;
  isHierarchyResolved: boolean;
  delegatedIndicators: HeaderDelegatedWorkIndicator[];
}

export interface HeaderDelegatedWorkIndicator {
  id: string;
  sessionId: string;
  sessionLinkId: string;
  title: string;
  avatarName: string;
  initial: string;
  colorClassName: string;
  statusLabel: string;
  source: "subagent" | "review";
}

export interface HeaderChatMenuEntry {
  id: string;
  title: string;
  agentKind: string;
  viewState: SessionViewState;
  isActive: boolean;
  isVisible: boolean;
}

export type HeaderChatStripRow = HeaderStripRow<HeaderChatTabEntry>;
export type HeaderWorkspaceShellStripRow = HeaderShellStripRow<HeaderChatTabEntry>;
