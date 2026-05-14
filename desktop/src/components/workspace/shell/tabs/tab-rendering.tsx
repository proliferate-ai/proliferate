import type { ReactNode } from "react";
import {
  BrailleSweepBadge,
  CircleAlert,
  MessageSquare,
} from "@/components/ui/icons";
import { ProviderIcon } from "@/components/ui/provider-icons";
import type {
  HeaderDelegatedWorkIndicator,
  HeaderChatMenuEntry,
  HeaderChatTabEntry,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";

export function renderChatTabIcon(
  tab: Pick<HeaderChatTabEntry | HeaderChatMenuEntry, "agentKind" | "viewState">,
): ReactNode {
  if (tab.viewState === "working") {
    return renderChatTabActivityIcon("text-info");
  }

  if (tab.viewState === "needs_input") {
    return renderChatTabActivityIcon("text-info");
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

export function renderChatTabDelegatedIndicators(
  indicators: readonly HeaderDelegatedWorkIndicator[],
): ReactNode {
  if (indicators.length === 0) {
    return null;
  }
  const visible = indicators.slice(0, 3);
  const overflow = indicators.length - visible.length;
  return (
    <span className="ml-1 flex shrink-0 items-center">
      {visible.map((indicator, index) => (
        <span
          key={indicator.id}
          title={`${indicator.avatarName}\n${indicator.title}\n${indicator.statusLabel}`}
          className={`flex size-4 items-center justify-center rounded-full border border-card text-[9px] font-medium leading-none text-white shadow-sm ${indicator.colorClassName} ${
            index > 0 ? "-ml-1.5" : ""
          }`}
        >
          {indicator.initial}
        </span>
      ))}
      {overflow > 0 && (
        <span className="-ml-1.5 rounded-full border border-card bg-muted px-1 text-[9px] font-medium leading-4 text-muted-foreground">
          +{overflow}
        </span>
      )}
    </span>
  );
}

export function renderChatMenuStatus(
  _tab: Pick<HeaderChatMenuEntry, "viewState" | "isActive">,
): ReactNode {
  return undefined;
}
