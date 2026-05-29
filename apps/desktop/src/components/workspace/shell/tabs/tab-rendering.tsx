import type { ReactNode } from "react";
import { SkeletonBlock } from "@/components/feedback/Skeleton";
import {
  CircleAlert,
  Clock,
  MessageSquare,
  Robot,
  Spinner,
} from "@/components/ui/icons";
import { ProviderIcon } from "@/components/ui/provider-icons";
import type { DelegatedWorkTabIdentity } from "@/lib/domain/delegated-work/model";
import type {
  HeaderChatMenuEntry,
  HeaderChatTabEntry,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";

export function renderChatTabIcon(
  tab: Pick<HeaderChatTabEntry, "agentKind" | "viewState" | "delegatedAgent" | "isResolvingSession">
    | (Pick<HeaderChatMenuEntry, "agentKind" | "viewState" | "isResolvingSession"> & { delegatedAgent?: null }),
): ReactNode {
  if (tab.delegatedAgent) {
    return renderDelegatedAgentIcon(tab.delegatedAgent);
  }

  if (tab.isResolvingSession) {
    return <SkeletonBlock className="size-3 rounded-sm" />;
  }

  if (tab.viewState === "working") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center">
        <Spinner className="size-3.5 text-foreground" />
      </span>
    );
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
    <ProviderIcon kind={tab.agentKind} className="size-3 shrink-0" />
  ) : (
    <MessageSquare className="size-3 shrink-0" />
  );
}

function renderDelegatedAgentIcon(agent: DelegatedWorkTabIdentity): ReactNode {
  const badgeClassName = delegatedAgentStatusDotClassName(agent.statusCategory);
  return (
    <span
      className={`relative flex size-4 shrink-0 items-center justify-center ${agent.identity.textColorClassName}`}
      title={agent.hoverTitle}
    >
      <Robot className="size-3.5" aria-hidden="true" />
      {badgeClassName && (
        <span
          aria-hidden="true"
          className={`absolute -right-0.5 -top-0.5 size-1.5 rounded-full ring-1 ring-background ${badgeClassName}`}
        />
      )}
    </span>
  );
}

function delegatedAgentStatusDotClassName(
  category: DelegatedWorkTabIdentity["statusCategory"],
): string | null {
  switch (category) {
    case "needs_attention":
      return "bg-warning-foreground";
    case "failed":
      return "bg-destructive";
    case "running":
      return "animate-pulse bg-current";
    case "queued":
    case "wake_scheduled":
      return "bg-muted-foreground";
    case "finished":
    case "closed":
      return null;
  }
}

function renderChatTabActivityIcon(colorClassName: string): ReactNode {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      <Clock className={`size-3 shrink-0 ${colorClassName}`} />
    </span>
  );
}

export function getChatTabLabel(
  tab: Pick<HeaderChatTabEntry, "title" | "delegatedAgent">,
): string {
  return tab.delegatedAgent?.identity.generatedName ?? tab.title;
}

export function renderChatTabStatusBadge(
  tab: Pick<HeaderChatTabEntry | HeaderChatMenuEntry, "viewState" | "hasUnreadActivity">,
): ReactNode {
  if (
    tab.hasUnreadActivity
    && tab.viewState !== "needs_input"
    && tab.viewState !== "working"
    && tab.viewState !== "errored"
  ) {
    return (
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-info"
      />
    );
  }
  return undefined;
}

export function renderChatMenuStatus(
  tab: Pick<HeaderChatMenuEntry, "viewState" | "isActive" | "hasUnreadActivity">,
): ReactNode {
  if (!tab.isActive) {
    return renderChatTabStatusBadge(tab);
  }
  return undefined;
}
