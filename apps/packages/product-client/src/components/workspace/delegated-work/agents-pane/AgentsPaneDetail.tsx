import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SubagentRosterEntry } from "@anyharness/sdk";
import { ArrowLeft } from "#product/primitives/icons/core";
import { Button } from "#product/primitives/Button";
import { AgentIdentityGlyph } from "#product/components/workspace/delegated-work/AgentIdentityGlyph";
import { MessageList } from "#product/components/workspace/chat/transcript/MessageList";
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
}: AgentsPaneDetailProps) {
  const rosterPresentation = child.agent.status.presentation;
  const identityKey = `${parentSessionId}:${childSessionId}`;
  const currentIdentityRef = useRef(identityKey);
  currentIdentityRef.current = identityKey;
  // Accepted lifecycle responses are immediate truth even while a roster
  // invalidation is still in flight. Key the override to the durable target so
  // a late response from child A can never change child B after navigation.
  const [presentationTruth, setPresentationTruth] = useState<{
    identityKey: string;
    presentation: SubagentRosterEntry["agent"]["status"]["presentation"];
  } | null>(null);
  const presentation = presentationTruth?.identityKey === identityKey
    ? presentationTruth.presentation
    : rosterPresentation;
  useEffect(() => {
    if (
      presentationTruth?.identityKey === identityKey
      && presentationTruth.presentation === rosterPresentation
    ) {
      setPresentationTruth(null);
    }
  }, [identityKey, presentationTruth, rosterPresentation]);
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
  const {
    closeChild,
    openChild,
    promoteChild,
    closePending,
    openPending,
    promotePending,
  } = useAgentsPaneLifecycleActions({ workspaceId });

  const [closeConfirmFor, setCloseConfirmFor] = useState<string | null>(null);
  const [promoteConfirmFor, setPromoteConfirmFor] = useState<string | null>(null);
  const closeConfirmOpen = closeConfirmFor === identityKey;
  const promoteConfirmOpen = promoteConfirmFor === identityKey;
  const target = useMemo(() => ({
    parentSessionId,
    childSessionId,
    clientSessionId,
  }), [childSessionId, clientSessionId, parentSessionId]);

  const performClose = useCallback(async () => {
    const operationIdentity = identityKey;
    const outcome = await closeChild(target);
    if (currentIdentityRef.current === operationIdentity) {
      setCloseConfirmFor(null);
    }
    if (outcome.ok) {
      if (currentIdentityRef.current === operationIdentity) {
        setPresentationTruth({
          identityKey: operationIdentity,
          presentation: outcome.agent.status.presentation,
        });
      }
      onClosed?.(outcome);
    } else {
      onLifecycleError?.(outcome);
    }
  }, [closeChild, identityKey, onClosed, onLifecycleError, target]);

  const requestClose = useCallback(() => {
    if (presentation === "running") {
      setCloseConfirmFor(identityKey);
      return;
    }
    // Available closes immediately, without confirmation.
    void performClose();
  }, [identityKey, performClose, presentation]);

  const performOpen = useCallback(async () => {
    const operationIdentity = identityKey;
    const outcome = await openChild(target);
    if (outcome.ok) {
      if (currentIdentityRef.current === operationIdentity) {
        setPresentationTruth({
          identityKey: operationIdentity,
          presentation: outcome.presentation,
        });
      }
      onOpened?.(outcome);
    } else {
      onLifecycleError?.(outcome);
    }
  }, [identityKey, onLifecycleError, onOpened, openChild, target]);

  const performPromote = useCallback(async () => {
    const operationIdentity = identityKey;
    const outcome = await promoteChild(target);
    if (currentIdentityRef.current === operationIdentity) {
      setPromoteConfirmFor(null);
    }
    if (outcome.ok) {
      onPromoted?.(outcome);
    } else {
      onLifecycleError?.(outcome);
    }
  }, [identityKey, onLifecycleError, onPromoted, promoteChild, target]);

  const showConnecting = !isClosed && (
    lifecycle.streamRequestPending
    || lifecycle.streamConnectionState === "connecting"
  );
  const showDisconnected = !isClosed
    && lifecycle.historyPhase === "ready"
    && !lifecycle.streamRequestPending
    && lifecycle.streamConnectionState === "disconnected";

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
              disabled={openPending}
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
              disabled={closePending}
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
              disabled={promotePending}
              onClick={() => setPromoteConfirmFor(identityKey)}
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
