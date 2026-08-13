import { useState, type ReactNode } from "react";
import { SkeletonBlock } from "#product/primitives/Skeleton";
import { StatusDot } from "#product/primitives/StatusDot";
import { CircleAlert } from "#product/primitives/icons/status";
import { Clock } from "#product/primitives/icons/core";
import { MessageSquare } from "#product/primitives/icons/product";
import { Spinner } from "#product/primitives/Spinner";
import { ProviderIcon } from "#product/primitives/icons/provider-icons";
import {
  DotCellLoader,
  type DotCellLoaderVariant,
} from "#product/primitives/DotCellLoader";
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

// Position (`absolute -right-0.5 -top-0.5`) and the `ring-1 ring-background`
// halo stay inline at the call site: StatusDot's variant budget is tone x
// fill only (DESIGN_SYSTEM.md), and layout/position was never a StatusDot
// axis to begin with.
const DELEGATED_AGENT_DOT_POSITION_CLASS = "absolute -right-0.5 -top-0.5 ring-1 ring-background";

function renderDelegatedAgentIcon(agent: DelegatedWorkTabIdentity): ReactNode {
  const dot = delegatedAgentStatusDot(agent.statusCategory);
  return (
    <span
      className={`relative flex size-4 shrink-0 items-center justify-center ${agent.identity.textColorClassName}`}
      title={agent.hoverTitle}
    >
      <DelegatedAgentIdenticon identity={agent.identity} className="size-3.5" />
      {dot}
    </span>
  );
}

function delegatedAgentStatusDot(
  category: DelegatedWorkTabIdentity["statusCategory"],
): ReactNode | null {
  switch (category) {
    case "needs_attention":
      return <StatusDot tone="warning" className={DELEGATED_AGENT_DOT_POSITION_CLASS} />;
    case "failed":
      return <StatusDot tone="danger" className={DELEGATED_AGENT_DOT_POSITION_CLASS} />;
    case "running":
      // StatusDot's two axes are tone x fill; there is no pulsing,
      // currentColor-inheriting tone. Kept as the one hand-rolled site per
      // the wave-2 ruling (DESIGN_SYSTEM.md's UI-conformance review, shell
      // slice) rather than widening StatusDot's variant budget for a single
      // caller. Sized with `icon-status` — the same semantic sizing utility
      // StatusDot uses internally — so this dot stays the same size as its
      // three siblings above, which already moved off a fixed size-* utility
      // when they adopted StatusDot.
      return (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 icon-status animate-pulse rounded-full bg-current ring-1 ring-background"
        />
      );
    case "queued":
    case "wake_scheduled":
      return <StatusDot tone="muted" className={DELEGATED_AGENT_DOT_POSITION_CLASS} />;
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
