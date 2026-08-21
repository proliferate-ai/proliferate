import { useEffect, useState } from "react";
import {
  useAgentGatewayEnrollment,
  useAuthSelections,
} from "@proliferate/cloud-sdk-react";
import { isFeatureEnabled } from "#product/config/feature-flags";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";
import {
  AUTH_SETUP_GRACE_MS,
  resolveAuthSetupStep,
  type AuthSetupStepState,
} from "#product/lib/domain/agents/auth-onboarding";
import { useAuthSetupOnboardingStore } from "#product/stores/agents/auth-setup-onboarding-store";

/**
 * Poll cadence while the step awaits the delivery ack (matches the panes'
 * DELIVERY_PENDING_POLL_MS — the acks land out-of-band, server- or
 * sync-hook-side, so there is no client mutation to invalidate on).
 *
 * Named exception (does not sit on the `cadence` scale): 3s falls strictly
 * between `cadence.fastMs` (1s) and `cadence.standardMs` (5s). This is the
 * onboarding "setting up" step the user is actively watching resolve;
 * snapping down to fast would tighten (forbidden), and snapping up to
 * standard would visibly stretch a step already racing an ~20s grace window
 * before it auto-advances. Kept in lockstep with the harness panes'
 * `DELIVERY_PENDING_POLL_MS` instead of force-fitting a token (UX Latency +
 * Transitions ADR §4.7, Rung 6, Q8).
 */
const AUTH_SETUP_POLL_MS = 3000;

/**
 * The ack-gated onboarding "setting up" step (agent-auth.md, Proof C7).
 *
 * Signup/auth never waited on LiteLLM provisioning — enrollment runs in the
 * background. After the first-run adoption posts its gateway selections
 * (recorded in the auth-setup store), this step watches those selections'
 * `applied` flags on the local surface, polling through the existing
 * refetchInterval seam. It resolves to "applied" once every adopted selection
 * is acknowledged under a synced enrollment; an unsynced (or unreadable)
 * enrollment is the same pending state, never an error. If the ~20s grace
 * window passes first the step auto-advances ("advanced") and the harness
 * panes' ordinary pending indicator carries on — the step never hard-blocks.
 *
 * Both outcomes latch in the store, so polling stops and a later manual auth
 * edit going pending never resurrects the onboarding card.
 */
export function useAuthSetupOnboardingStep(): AuthSetupStepState {
  const { authStatus, controlPlaneReachable } = useCloudAvailabilityState();
  // Control-plane gate, NOT a cloud-compute gate: this step watches auth
  // selections and gateway enrollment, both control-plane state independent of
  // cloud COMPUTE. Matches `useFirstRunAuthAdoption` — if adoption ran, the
  // step that watches its acks must be able to run too.
  const authReady = authStatus === "authenticated" && controlPlaneReachable;
  const adoptedHarnessKinds = useAuthSetupOnboardingStore(
    (store) => store.adoptedHarnessKinds,
  );
  const adoptionStartedAt = useAuthSetupOnboardingStore(
    (store) => store.adoptionStartedAt,
  );
  const settled = useAuthSetupOnboardingStore((store) => store.settled);
  const markSettled = useAuthSetupOnboardingStore((store) => store.markSettled);

  // rung 7: the evidence-bound card (agentAuthEvidencePanes) replaces this
  // timer step. With the flag ON this hook goes dormant — no watching, no
  // polling, no latch write — and `useAuthSetupOnboardingEvidence` owns the
  // card. With the flag OFF (the default) everything below is unchanged.
  const evidenceOn = isFeatureEnabled("agentAuthEvidencePanes");

  const watching =
    !evidenceOn
    && settled === null
    && adoptedHarnessKinds !== null
    && adoptedHarnessKinds.length > 0;

  // Grace window (~20s from the adoption writes): expiry only ever ADVANCES
  // the step — it never blocks and never turns into an error state.
  const [graceExpired, setGraceExpired] = useState(false);
  useEffect(() => {
    if (!watching || adoptionStartedAt === null) {
      return;
    }
    const remaining = adoptionStartedAt + AUTH_SETUP_GRACE_MS - Date.now();
    if (remaining <= 0) {
      setGraceExpired(true);
      return;
    }
    const timer = setTimeout(() => setGraceExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [watching, adoptionStartedAt]);

  const selectionsQuery = useAuthSelections("local", authReady && watching, {
    refetchInterval: watching ? AUTH_SETUP_POLL_MS : false,
  });
  // Enrollment sync (keys minted) is part of the same pending truth: a state
  // acked before sync lacks the key, and sync bumps the revision back to
  // pending — so resolution requires synced AND applied.
  const enrollmentQuery = useAgentGatewayEnrollment(authReady && watching, {
    refetchInterval: watching ? AUTH_SETUP_POLL_MS : false,
  });
  // An errored enrollment read (e.g. the 404 before the row exists, or
  // LiteLLM-down provisioning trouble) reads as an observed NON-synced state:
  // pending, then the grace advances — never a failure.
  const enrollmentSyncStatus =
    enrollmentQuery.data?.syncStatus
    ?? (enrollmentQuery.isError ? "none" : undefined);

  const state: AuthSetupStepState = evidenceOn
    ? "hidden"
    : settled
    ?? resolveAuthSetupStep({
      adoptedHarnessKinds,
      selections: selectionsQuery.data,
      enrollmentSyncStatus,
      graceExpired,
    });

  useEffect(() => {
    if (settled !== null) {
      return;
    }
    if (state === "applied" || state === "advanced") {
      markSettled(state);
    }
  }, [markSettled, settled, state]);

  return state;
}
