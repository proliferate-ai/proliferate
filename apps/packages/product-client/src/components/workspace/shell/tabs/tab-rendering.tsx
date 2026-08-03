import { useState, type ReactNode } from "react";
import { SkeletonBlock } from "#product/components/feedback/Skeleton";
import {
  CircleAlert,
  Clock,
  MessageSquare,
  Spinner,
} from "@proliferate/ui/icons";
import { ProviderIcon } from "@proliferate/ui/icons/provider-icons";
import {
  DotCellLoader,
  type DotCellLoaderVariant,
} from "@proliferate/ui/primitives/DotCellLoader";
import { DelegatedAgentIdenticon } from "#product/components/workspace/delegated-work/DelegatedAgentIdenticon";
import type { DelegatedWorkTabIdentity } from "#product/lib/domain/delegated-work/model";
import type {
  HeaderChatMenuEntry,
  HeaderChatTabEntry,
} from "#product/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";

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
        <Spinner className="icon-paired text-foreground" />
      </span>
    );
  }

  if (tab.viewState === "needs_input") {
    return renderChatTabActivityIcon("text-info");
  }

  if (tab.viewState === "errored") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center">
        <CircleAlert className="icon-compact shrink-0 text-destructive" />
      </span>
    );
  }

  return tab.agentKind ? (
    <ProviderIcon kind={tab.agentKind} className="icon-compact shrink-0 [font-size:var(--text-sidebar-row)]" />
  ) : (
    <MessageSquare className="icon-compact shrink-0" />
  );
}

function renderDelegatedAgentIcon(agent: DelegatedWorkTabIdentity): ReactNode {
  const badgeClassName = delegatedAgentStatusDotClassName(agent.statusCategory);
  return (
    <span
      className={`relative flex size-4 shrink-0 items-center justify-center ${agent.identity.textColorClassName}`}
      title={agent.hoverTitle}
    >
      <DelegatedAgentIdenticon identity={agent.identity} className="size-3.5" />
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
      <Clock className={`icon-compact shrink-0 ${colorClassName}`} />
    </span>
  );
}

export function getChatTabLabel(
  tab: Pick<HeaderChatTabEntry, "title" | "delegatedAgent">,
): string {
  return tab.delegatedAgent?.identity.generatedName ?? tab.title;
}

export function renderChatTabStatusBadge(
  tab: Pick<HeaderChatTabEntry | HeaderChatMenuEntry, "id" | "viewState" | "hasUnreadActivity">,
): ReactNode {
  if (tab.viewState === "working") {
    return <RunningChatTabIndicator sessionId={tab.id} />;
  }
  runningLoaderVariantsBySession.delete(tab.id);
  if (tab.viewState === "needs_input") {
    return (
      <span role="img" aria-label="Waiting for input" className="inline-flex shrink-0 text-sidebar-muted-foreground">
        <DotCellLoader aria-hidden="true" variant="breathe" />
      </span>
    );
  }
  if (tab.viewState === "errored") {
    return (
      <CircleAlert
        role="img"
        aria-label="Session error"
        className="icon-compact shrink-0 text-sidebar-status-error [font-size:var(--text-sidebar-row)]"
      />
    );
  }
  if (
    tab.hasUnreadActivity
  ) {
    return (
      <span
        aria-hidden="true"
        className="icon-status shrink-0 rounded-full bg-sidebar-status-unseen [font-size:var(--text-sidebar-row)]"
      />
    );
  }
  return undefined;
}

const RUNNING_LOADER_VARIANTS: readonly DotCellLoaderVariant[] = [
  "wave",
  "orbit",
  "scan",
  "helix",
];

const runningLoaderVariantsBySession = new Map<string, DotCellLoaderVariant>();

function RunningChatTabIndicator({ sessionId }: { sessionId: string }) {
  const [variant] = useState<DotCellLoaderVariant>(() => {
    const retainedVariant = runningLoaderVariantsBySession.get(sessionId);
    if (retainedVariant) {
      return retainedVariant;
    }
    const index = Math.floor(Math.random() * RUNNING_LOADER_VARIANTS.length);
    const nextVariant = RUNNING_LOADER_VARIANTS[index] ?? "wave";
    runningLoaderVariantsBySession.set(sessionId, nextVariant);
    return nextVariant;
  });
  return (
    <span role="img" aria-label="Working" className="inline-flex shrink-0 text-sidebar-muted-foreground">
      <DotCellLoader aria-hidden="true" variant={variant} />
    </span>
  );
}

export function renderChatMenuStatus(
  tab: Pick<HeaderChatMenuEntry, "id" | "viewState" | "isActive" | "hasUnreadActivity">,
): ReactNode {
  if (!tab.isActive) {
    return renderChatTabStatusBadge(tab);
  }
  return undefined;
}
