import { create } from "zustand";

/**
 * Session-scoped record of what the first-run auth adoption did, feeding the
 * state-bound onboarding "setting up" card (agent_auth §4 cell 4).
 *
 * `useFirstRunAuthAdoption` records its one-shot decision here — the adopted
 * harness kinds, possibly none. `useAuthSetupOnboardingEvidence` folds each
 * adopted agent's status document and latches `settled` once every one of them
 * reaches a terminal state, so a later manual auth edit going pending never
 * resurrects the card.
 *
 * `settled` is a plain boolean: the grace-window "advanced" latch went with the
 * timer step, leaving one way to settle, and a single-member string union is a
 * boolean wearing a costume. There is likewise no `adoptionStartedAt` — the only
 * thing that ever read a start time was the ~20s timer, and nothing here
 * advances on a clock.
 *
 * Deliberately in-memory only: adoption runs once per app run, and a restart
 * that finds existing selections adopts nothing — so nothing here needs to
 * persist.
 */
interface AuthSetupOnboardingStoreState {
  /** null until the adoption decision ran; [] when it adopted nothing. */
  adoptedHarnessKinds: string[] | null;
  /** True once every adopted agent reached a terminal state. Latches. */
  settled: boolean;
  recordAdoption: (harnessKinds: readonly string[]) => void;
  markSettled: () => void;
  resetForTests: () => void;
}

export const useAuthSetupOnboardingStore = create<AuthSetupOnboardingStoreState>(
  (set) => ({
    adoptedHarnessKinds: null,
    settled: false,
    recordAdoption: (harnessKinds) =>
      set({ adoptedHarnessKinds: [...harnessKinds] }),
    markSettled: () => set({ settled: true }),
    resetForTests: () => set({ adoptedHarnessKinds: null, settled: false }),
  }),
);
