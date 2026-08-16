import { useEffect, useMemo } from "react";
import { isFeatureEnabled } from "#product/config/feature-flags";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import {
  resolveAuthSetupEvidence,
  type AuthSetupEvidence,
} from "#product/lib/domain/agents/auth-setup-badges";
import { useAuthSetupOnboardingStore } from "#product/stores/agents/auth-setup-onboarding-store";

/**
 * The evidence-bound onboarding "setting up" card (agent-auth.md rung 7, flag
 * agentAuthEvidencePanes). It replaces `useAuthSetupOnboardingStep`'s ~20s
 * timer with per-agent badges bound to the REAL install, ack, and probe states
 * off the agents projection.
 *
 * The adopted harness kinds still come from `useFirstRunAuthAdoption` via the
 * shared store, but the resolution is a pure fold of each adopted agent's
 * `installState` and derived `authState` — no grace window, no clock. The card
 * completes (and latches, so a later pending edit never resurrects it) once
 * every adopted agent reaches a terminal state: launchable or an actionable
 * next step. With the flag OFF this hook is dormant and returns null; the timer
 * step owns the card.
 *
 * Returns null while there is no card to show (flag off, adoption undecided or
 * empty, or already settled); otherwise the badges and the completion flag.
 */
export function useAuthSetupOnboardingEvidence(): AuthSetupEvidence | null {
  const evidenceOn = isFeatureEnabled("agentAuthEvidencePanes");
  const { agentsByKind } = useAgentCatalog();
  const adoptedHarnessKinds = useAuthSetupOnboardingStore(
    (store) => store.adoptedHarnessKinds,
  );
  const settled = useAuthSetupOnboardingStore((store) => store.settled);
  const markSettled = useAuthSetupOnboardingStore((store) => store.markSettled);

  const watching =
    evidenceOn
    && settled === null
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
