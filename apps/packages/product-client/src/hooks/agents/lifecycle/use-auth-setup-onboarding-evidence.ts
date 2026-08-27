import { useEffect, useMemo } from "react";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import {
  resolveAuthSetupEvidence,
  type AuthSetupEvidence,
} from "#product/lib/domain/agents/auth-setup-badges";
import { useAuthSetupOnboardingStore } from "#product/stores/agents/auth-setup-onboarding-store";

/**
 * The state-bound onboarding "setting up" card (agent_auth §4 cell 4: "The
 * onboarding card is state-bound, never timed"). It is the ONLY setup card —
 * the ~20s timer step it replaced, and the flag that used to choose between
 * them, are both gone.
 *
 * The adopted harness kinds still come from `useFirstRunAuthAdoption` via the
 * shared store, but the resolution is a pure fold of each adopted agent's
 * `installState` and its status document — no grace window, no clock. The card
 * completes (and latches, so a later pending edit never resurrects it) once
 * every adopted agent reaches a terminal state.
 *
 * Returns null while there is no card to show (adoption undecided or empty, or
 * already settled); otherwise the badges and the completion flag.
 */
export function useAuthSetupOnboardingEvidence(): AuthSetupEvidence | null {
  const { agentsByKind } = useAgentCatalog();
  const adoptedHarnessKinds = useAuthSetupOnboardingStore(
    (store) => store.adoptedHarnessKinds,
  );
  const settled = useAuthSetupOnboardingStore((store) => store.settled);
  const markSettled = useAuthSetupOnboardingStore((store) => store.markSettled);

  const watching =
    settled === null
    && adoptedHarnessKinds !== null
    && adoptedHarnessKinds.length > 0;

  const evidence = useMemo(() => {
    if (!watching || adoptedHarnessKinds === null) {
      return null;
    }
    return resolveAuthSetupEvidence(adoptedHarnessKinds, agentsByKind);
  }, [watching, adoptedHarnessKinds, agentsByKind]);

  useEffect(() => {
    if (settled !== null || evidence === null) {
      return;
    }
    if (evidence.done) {
      // Completion is state-bound, never timer-bound. Latch "applied" so the
      // card stays gone once every adopted agent is terminal.
      markSettled("applied");
    }
  }, [markSettled, settled, evidence]);

  if (!watching || evidence === null || evidence.done) {
    return null;
  }
  return evidence;
}
