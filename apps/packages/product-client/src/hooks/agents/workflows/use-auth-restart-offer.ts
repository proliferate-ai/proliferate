import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthSelections } from "@proliferate/cloud-sdk-react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";
import {
  authAppliedTransitions,
  authScopeEquals,
  matchRunningSessions,
  pendingAuthScopeKeys,
  type AuthSwitchScope,
} from "#product/lib/domain/agents/auth-restart-offer";
import type { SessionDirectoryEntry } from "#product/lib/domain/sessions/directory/directory-entry";
import { restartSessionsOnNewAuth } from "#product/lib/access/anyharness/session-restart";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";

export interface AuthRestartOfferApi {
  /** The switch the modal is currently offering a restart for, or null. */
  offer: AuthSwitchScope | null;
  /** Running sessions of the offered (harness, surface) — recomputed live. */
  offeredSessions: SessionDirectoryEntry[];
  /** "yes, restart now": relaunch the sessions matching at answer time. */
  restartNow: () => void;
  /** "no": close the modal. Stateless — nothing recorded, nothing reminded. */
  decline: () => void;
}

/**
 * Restart-offer trigger (agent-auth.md "Running sessions are offered a
 * restart", Proof C6): watches the shared auth-selections query for a scope's
 * pending→applied flip (the acknowledgement C-2 built — the desktop sync
 * hook's ack POST for local, the cloud materializer's ack server-side) and,
 * when the switched (harness, surface) has running sessions, offers the
 * restart modal once for that switch.
 *
 * Latest-wins: a later switch acking before the modal is answered re-scopes
 * the offer to that switch; answering applies to the sessions matching at
 * answer time. Declining does nothing and persists nothing.
 */
export function useAuthRestartOffer(): AuthRestartOfferApi {
  const { authStatus, controlPlaneReachable } = useCloudAvailabilityState();
  const authReady = authStatus === "authenticated" && controlPlaneReachable;
  const host = useProductHost();
  const cloudClient = host.cloud.client;

  // Passive subscriber to the same query the harness panes drive: their
  // pending-poll (and the desktop sync hook's post-ack invalidation) refresh
  // this cache, so the flip is observable here without a second poll loop.
  const selectionsQuery = useAuthSelections(null, authReady);
  const selections = selectionsQuery.data;

  const [offer, setOffer] = useState<AuthSwitchScope | null>(null);
  const previousPendingRef = useRef<ReadonlySet<string> | null>(null);

  useEffect(() => {
    if (selections === undefined) {
      return;
    }
    const previousPending = previousPendingRef.current;
    previousPendingRef.current = pendingAuthScopeKeys(selections);
    if (previousPending === null) {
      // First observation only seeds the baseline — a scope that is already
      // applied at app start never produces an offer.
      return;
    }
    const transitions = authAppliedTransitions(previousPending, selections);
    if (transitions.length === 0) {
      return;
    }
    // Latest-wins: the last transitioned scope is the newest switch.
    const latest = transitions[transitions.length - 1]!;
    const running = matchRunningSessions(
      Object.values(useSessionDirectoryStore.getState().entriesById),
      latest,
    );
    setOffer((current) => {
      if (running.length > 0) {
        return latest;
      }
      // The newest switch has nothing to restart. If it re-switched the scope
      // the open modal was about, that offer is superseded — close it. An
      // unrelated scope's ack leaves an open offer alone.
      return current !== null && authScopeEquals(current, latest) ? null : current;
    });
  }, [selections]);

  const entriesById = useSessionDirectoryStore((state) => state.entriesById);
  const offeredSessions = useMemo(
    () => (offer === null
      ? []
      : matchRunningSessions(Object.values(entriesById), offer)),
    [entriesById, offer],
  );

  const restartNow = useCallback(() => {
    if (offer === null) {
      return;
    }
    // Answer-time scoping: relaunch exactly what is running NOW.
    const targets = matchRunningSessions(
      Object.values(useSessionDirectoryStore.getState().entriesById),
      offer,
    ).map((entry) => ({
      sessionId: entry.sessionId,
      workspaceId: entry.workspaceId,
    }));
    setOffer(null);
    if (targets.length === 0) {
      return;
    }
    // Fire-and-forget: per-session failures surface through each session's
    // normal error state (the executor tolerates them), never a modal error.
    void restartSessionsOnNewAuth(targets, cloudClient);
  }, [cloudClient, offer]);

  const decline = useCallback(() => {
    // Decline is stateless by ruling: close the modal, record nothing.
    setOffer(null);
  }, []);

  return { offer, offeredSessions, restartNow, decline };
}
