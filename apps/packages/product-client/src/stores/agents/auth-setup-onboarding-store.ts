import { create } from "zustand";

/**
 * Session-scoped record of what the first-run auth adoption did, feeding the
 * state-bound onboarding "setting up" card (agent_auth §4 cell 4).
 *
 * `useFirstRunAuthAdoption` records its one-shot decision here — the adopted
 * harness kinds (possibly none) and when that decision settled. For a
 * nonempty decision, settlement is also when the writes fired.
 * `useAuthSetupOnboardingEvidence` folds each adopted agent's status document
 * and latches `settled` once every one of them reaches a terminal state, so a
 * later manual auth edit going pending never resurrects the card.
 *
 * Deliberately in-memory only: adoption runs once per app run, and a restart
 * that finds existing selections adopts nothing — so nothing here needs to
 * persist.
 */

/**
 * The card latches once, on the states themselves. The grace-window
 * "advanced" latch went with the timer step: nothing advances this on a clock.
 */
export type AuthSetupSettledState = "applied";

interface AuthSetupOnboardingStoreState {
  /** null until the adoption decision ran; [] when it adopted nothing. */
  adoptedHarnessKinds: string[] | null;
  /** Epoch ms when adoption settled; nonempty decisions dispatch writes then. */
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
