import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SubagentRosterEntry } from "@anyharness/sdk";
import { ArrowLeft } from "#product/primitives/icons/core";
import { Button } from "#product/primitives/Button";
import { AgentIdentityGlyph } from "#product/components/workspace/delegated-work/AgentIdentityGlyph";
import { MessageList } from "#product/components/workspace/chat/transcript/MessageList";
import { useTranscriptSessionNavigationActions } from "#product/hooks/chat/workflows/use-transcript-session-navigation-actions";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import { getProviderDisplayName } from "#product/lib/domain/agents/provider-display";
import { useTranscriptPaneStateForSession } from "#product/hooks/chat/derived/use-active-session-transcript-state";
import {
  useAgentsPaneSessionLifecycle,
} from "#product/hooks/agents/lifecycle/use-agents-pane-session-lifecycle";
import {
  useAgentsPaneLifecycleActions,
  type AgentsPaneCloseOutcome,
  type AgentsPaneLifecycleFailure,
  type AgentsPaneOpenOutcome,
  type AgentsPanePromoteOutcome,
} from "#product/hooks/agents/workflows/use-agents-pane-lifecycle-actions";
import { AgentsPaneComposer } from "#product/components/workspace/delegated-work/agents-pane/AgentsPaneComposer";
import { AgentsPaneLifecycleDialogs } from "#product/components/workspace/delegated-work/agents-pane/AgentsPaneLifecycleDialogs";
import type { AgentsPaneAction } from "#product/lib/domain/delegated-work/agents-pane-model";

const STATUS_LABELS = {
  running: "Running",
  available: "Available",
  closed: "Closed",
} as const;

export interface AgentsPaneDetailProps {
  workspaceId: string;
  /** Durable parent/child session IDs used by the lifecycle routes. */
  parentSessionId: string;
  childSessionId: string;
  /** Mapped ProductClient client session ID the local stores are keyed by. */
  clientSessionId: string;
  /** Roster child projection this detail view describes. */
  child: SubagentRosterEntry;
  /** Guard: lifecycle work only runs while the Agents pane route is current. */
  isPaneRouteActive: boolean;
  onBack: () => void;
  onClosed?: (outcome: AgentsPaneCloseOutcome) => void;
  onOpened?: (outcome: AgentsPaneOpenOutcome) => void;
  onPromoted?: (outcome: AgentsPanePromoteOutcome) => void;
  onLifecycleError?: (failure: AgentsPaneLifecycleFailure) => void;
  requestedAction?: { token: number; action: AgentsPaneAction } | null;
  onRequestedActionHandled?: (token: number) => void;
}

/**
 * Agents-pane child detail: the child's transcript rendered from the existing
 * session stores, plus its Close/Open/Promote lifecycle lane. Non-Closed
 * children mount/hydrate/connect a pane-owned live stream; Closed children
 * hydrate history read-only with no stream and no composer. The main surface's
 * activeSessionId is never touched.
 */
export function AgentsPaneDetail({
  workspaceId,
  parentSessionId,
  childSessionId,
  clientSessionId,
  child,
  isPaneRouteActive,
  onBack,
  onClosed,
  onOpened,
  onPromoted,
  onLifecycleError,
  requestedAction = null,
  onRequestedActionHandled,
}: AgentsPaneDetailProps) {
  const presentation = child.agent.status.presentation;
  const identityKey = `${parentSessionId}:${childSessionId}`;
  const currentIdentityRef = useRef({ identityKey, token: Symbol(identityKey) });
  if (currentIdentityRef.current.identityKey !== identityKey) {
    currentIdentityRef.current = { identityKey, token: Symbol(identityKey) };
  }
  const identityToken = currentIdentityRef.current.token;
  const isClosed = presentation === "closed";

  const identity = useMemo(() => buildDelegatedAgentIdentity({
    id: childSessionId,
    title: child.agent.title ?? child.relationship.label,
    workspaceId,
    sessionId: childSessionId,
    sessionLinkId: child.relationship.sessionLinkId,
  }), [
    child.agent.title,
    child.relationship.label,
    child.relationship.sessionLinkId,
    childSessionId,
    workspaceId,
  ]);
  const agentTitle = identity.title;

  const lifecycle = useAgentsPaneSessionLifecycle({
    workspaceId,
    parentSessionId,
    childSessionId,
    clientSessionId,
    sessionLinkId: child.relationship.sessionLinkId,
    label: child.relationship.label ?? null,
    isClosed,
    isPaneRouteActive,
  });
  const paneState = useTranscriptPaneStateForSession(clientSessionId);
  const { canOpenTranscriptSession, openTranscriptSession } =
    useTranscriptSessionNavigationActions({
      sourceSessionId: clientSessionId,
      fallbackWorkspaceId: workspaceId,
      transcript: paneState.transcript,
    });
  const {
    closeChild,
    openChild,
    promoteChild,
    closePending,
    openPending,
    promotePending,
  } = useAgentsPaneLifecycleActions({ workspaceId });
  const lifecyclePending = closePending || openPending || promotePending;

  const [closeConfirmFor, setCloseConfirmFor] = useState<symbol | null>(null);
  const [promoteConfirmFor, setPromoteConfirmFor] = useState<symbol | null>(null);
  const closeConfirmOpen = closeConfirmFor === identityToken;
  const promoteConfirmOpen = promoteConfirmFor === identityToken;
  const target = useMemo(() => ({
    parentSessionId,
    childSessionId,
    clientSessionId,
  }), [childSessionId, clientSessionId, parentSessionId]);

  const performClose = useCallback(async () => {
    const operationIdentity = identityToken;
    const outcome = await closeChild(target);
    if (currentIdentityRef.current.token === operationIdentity) {
      setCloseConfirmFor(null);
    }
    if (outcome.ok) {
      onClosed?.(outcome);
    } else {
      onLifecycleError?.(outcome);
    }
  }, [closeChild, identityToken, onClosed, onLifecycleError, target]);

  const requestClose = useCallback(() => {
    if (presentation === "running") {
      setCloseConfirmFor(identityToken);
      return;
    }
    // Available closes immediately, without confirmation.
    void performClose();
  }, [identityToken, performClose, presentation]);

  const performOpen = useCallback(async () => {
    const outcome = await openChild(target);
    if (outcome.ok) {
      onOpened?.(outcome);
    } else {
      onLifecycleError?.(outcome);
    }
  }, [onLifecycleError, onOpened, openChild, target]);

  const performPromote = useCallback(async () => {
    const operationIdentity = identityToken;
    const outcome = await promoteChild(target);
    if (currentIdentityRef.current.token === operationIdentity) {
      setPromoteConfirmFor(null);
    }
    if (outcome.ok) {
      onPromoted?.(outcome);
    } else {
      onLifecycleError?.(outcome);
    }
  }, [identityToken, onLifecycleError, onPromoted, promoteChild, target]);

  const handledActionTokenRef = useRef<number | null>(null);
  useEffect(() => {
    if (
      !requestedAction
      || handledActionTokenRef.current === requestedAction.token
      || !isPaneRouteActive
    ) {
      return;
    }
    handledActionTokenRef.current = requestedAction.token;
    if (requestedAction.action === "close") {
      requestClose();
    } else if (requestedAction.action === "open") {
      void performOpen();
    } else {
      setPromoteConfirmFor(identityToken);
    }
    onRequestedActionHandled?.(requestedAction.token);
  }, [
    identityToken,
    isPaneRouteActive,
    onRequestedActionHandled,
    performOpen,
    requestClose,
    requestedAction,
  ]);

  const showConnecting = !isClosed && (
    lifecycle.streamRequestPending
    || lifecycle.streamConnectionState === "connecting"
  );
  const showDisconnected = !isClosed
    && lifecycle.historyPhase === "ready"
    && !lifecycle.streamRequestPending
    && (
      lifecycle.streamConnectionState === "disconnected"
      || lifecycle.streamConnectionState === "ended"
    );

  return (
    <section
      aria-label={`Subagent ${identity.displayName}`}
      aria-busy={lifecycle.historyPhase === "loading" || lifecycle.streamRequestPending}
      className="flex h-full min-h-0 min-w-0 flex-col"
    >
      <header className="flex shrink-0 flex-col gap-1 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Back to agents"
            onClick={onBack}
          >
            <ArrowLeft className="icon-compact" />
          </Button>
          <AgentIdentityGlyph
            identity={identity}
            dimension={20}
            closed={isClosed}
            label={identity.generatedName}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-ui font-medium text-foreground">
              {agentTitle}
            </span>
            <span className="truncate text-ui-sm text-muted-foreground">
              {STATUS_LABELS[presentation]}
              {" · "}
              {getProviderDisplayName(child.agent.configuration.agentKind)}
            </span>
          </div>
        </div>
        <div className="flex min-h-7 items-center justify-end gap-1.5 pl-9">
          {isClosed && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={openPending}
              disabled={lifecyclePending}
              onClick={() => void performOpen()}
            >
              Open
            </Button>
          )}
          {!isClosed && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={lifecyclePending}
              loading={closePending}
              onClick={requestClose}
            >
              Close
            </Button>
          )}
          {!isClosed && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={lifecyclePending}
              onClick={() => setPromoteConfirmFor(identityToken)}
            >
              Promote
            </Button>
          )}
        </div>
      </header>

      {showConnecting && (
        <div role="status" className="shrink-0 px-3 py-1 text-ui-sm text-muted-foreground">
          Connecting…
        </div>
      )}
      {showDisconnected && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 px-3 py-1 text-ui-sm text-muted-foreground"
        >
          <span>Live updates paused</span>
          <Button type="button" variant="ghost" size="sm" onClick={lifecycle.reconnect}>
            Reconnect
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {lifecycle.historyPhase === "error" ? (
          <div role="alert" className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <span className="text-ui text-muted-foreground">
              Couldn’t load this subagent’s transcript.
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={lifecycle.retryHistory}>
              Retry
            </Button>
          </div>
        ) : lifecycle.historyPhase === "loading" || !paneState.transcript ? (
          <div
            role="status"
            className="flex h-full items-center justify-center text-ui text-muted-foreground"
          >
            Loading transcript…
          </div>
        ) : (
          <MessageList
            activeSessionId={clientSessionId}
            selectedWorkspaceId={workspaceId}
            optimisticPrompt={paneState.optimisticPrompt}
            outboxEntries={paneState.outboxEntries}
            transcript={paneState.transcript}
            sessionViewState={isClosed ? "idle" : paneState.sessionViewState}
            goalEvents={paneState.goalEvents}
            contentSearchEnabled={false}
            onOpenSession={openTranscriptSession}
            canOpenSession={canOpenTranscriptSession}
          />
        )}
      </div>

      <footer className="shrink-0 px-3 pb-3 pt-2">
        {isClosed ? (
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate text-ui-sm text-muted-foreground">
              Closed. Transcript preserved and read-only.
            </span>
          </div>
        ) : lifecycle.historyPhase === "ready" && paneState.transcript ? (
          <AgentsPaneComposer
            clientSessionId={clientSessionId}
            workspaceId={workspaceId}
            agentDisplayName={identity.generatedName}
          />
        ) : null}
      </footer>

      <AgentsPaneLifecycleDialogs
        agentTitle={agentTitle}
        closeConfirmOpen={closeConfirmOpen}
        closePending={closePending}
        onCancelClose={() => setCloseConfirmFor(null)}
        onConfirmClose={() => void performClose()}
        promoteConfirmOpen={promoteConfirmOpen}
        promotePending={promotePending}
        onCancelPromote={() => setPromoteConfirmFor(null)}
        onConfirmPromote={() => void performPromote()}
      />
    </section>
  );
}
