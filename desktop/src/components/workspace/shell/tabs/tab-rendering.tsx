import type { ReactNode } from "react";
import {
  BrailleSweepBadge,
  CircleAlert,
  MessageSquare,
  ProviderIcon,
} from "@/components/ui/icons";
import type {
  HeaderChatMenuEntry,
  HeaderChatTabEntry,
} from "@/hooks/workspaces/tabs/use-workspace-header-tabs-view-model";

export function renderChatTabIcon(
  tab: Pick<HeaderChatTabEntry | HeaderChatMenuEntry, "agentKind" | "viewState">,
): ReactNode {
  if (tab.viewState === "working") {
    return renderChatTabActivityIcon("text-muted-foreground");
  }

  if (tab.viewState === "needs_input") {
    return renderChatTabActivityIcon("text-special");
  }

  if (tab.viewState === "errored") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center">
        <CircleAlert className="size-3 shrink-0 text-destructive" />
      </span>
    );
  }

  return tab.agentKind ? (
    <ProviderIcon kind={tab.agentKind} className="size-3.5 shrink-0" />
  ) : (
    <MessageSquare className="size-3 shrink-0" />
  );
}

function renderChatTabActivityIcon(colorClassName: string): ReactNode {
  return (
    <BrailleSweepBadge
      className={`h-3 text-[10px] [line-height:0.75rem] ${colorClassName}`}
    />
  );
}

export function renderChatTabStatusBadge(
  _tab: Pick<HeaderChatTabEntry | HeaderChatMenuEntry, "viewState">,
): ReactNode {
  return undefined;
}

export function renderChatMenuStatus(
  _tab: Pick<HeaderChatMenuEntry, "viewState" | "isActive">,
): ReactNode {
  return undefined;
}
