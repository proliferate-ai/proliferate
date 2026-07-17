import type { SessionViewState } from "@proliferate/product-domain/sessions/activity";
import type { DelegatedWorkTabIdentity } from "#product/lib/domain/delegated-work/model";
import type { GroupedChatTab } from "#product/lib/domain/workspaces/tabs/grouping";
import type { HeaderStripRow } from "#product/lib/domain/workspaces/tabs/group-rows";
import type { ManualChatGroupId } from "#product/lib/domain/workspaces/tabs/manual-groups";
import type { HeaderShellStripRow } from "#product/lib/domain/workspaces/tabs/shell-rows";

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
  /**
   * True when the session behind this tab has never run a prompt (a visible
   * empty chat). Read-only qualification signal: it feeds the tab's
   * `data-workspace-empty-chat` testid and nothing else.
   */
  isEmptyChat: boolean;
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
  closedAt: string | null;
}

export type HeaderChatStripRow = HeaderStripRow<HeaderChatTabEntry>;
export type HeaderWorkspaceShellStripRow = HeaderShellStripRow<HeaderChatTabEntry>;
