import { create } from "zustand";

/**
 * Session-scoped record of what the first-run auth adoption did, feeding the
 * ack-gated onboarding "setting up" step (agent-auth.md, Proof C7).
 *
 * `useFirstRunAuthAdoption` records its one-shot decision here — the adopted
 * harness kinds (possibly none) and when the writes fired. The step hook
 * (`useAuthSetupOnboardingStep`) watches those selections' `applied` flags
 * and latches `settled` once the step resolved ("applied") or the ~20s grace
 * window auto-advanced it ("advanced"), so a later manual auth edit going
 * pending never resurrects the onboarding card.
 *
 * Deliberately in-memory only: adoption runs once per app run, and a restart
 * that finds existing selections adopts nothing — so nothing here needs to
 * persist.
 */

export type AuthSetupSettledState = "applied" | "advanced";

interface AuthSetupOnboardingStoreState {
  /** null until the adoption decision ran; [] when it adopted nothing. */
  adoptedHarnessKinds: string[] | null;
  /** Epoch ms of the adoption writes — the grace window counts from here. */
  adoptionStartedAt: number | null;
  settled: AuthSetupSettledState | null;
  recordAdoption: (harnessKinds: readonly string[], startedAt: number) => void;
  markSettled: (state: AuthSetupSettledState) => void;
  resetForTests: () => void;
}

export const useAuthSetupOnboardingStore = create<AuthSetupOnboardingStoreState>(
  (set) => ({
    adoptedHarnessKinds: null,
    adoptionStartedAt: null,
    settled: null,
    recordAdoption: (harnessKinds, startedAt) =>
      set({ adoptedHarnessKinds: [...harnessKinds], adoptionStartedAt: startedAt }),
    markSettled: (state) => set({ settled: state }),
    resetForTests: () =>
      set({ adoptedHarnessKinds: null, adoptionStartedAt: null, settled: null }),
  }),
);
