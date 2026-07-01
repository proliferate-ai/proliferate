import { create } from "zustand";

// Tracks whether the user is ACTIVELY typing in the chat composer (a keystroke
// within the last TYPING_ACTIVE_WINDOW_MS).
//
// Why this exists (learned the hard way): rendering the transcript from a
// useDeferredValue unconditionally starves it while an agent streams — stream
// batches land every ~80-250ms, each one restarts the in-flight deferred
// render, and the transcript can freeze for seconds right after the user sends
// a message (measured: 6.6s to first transcript commit post-submit). Input
// priority is only the right trade WHILE INPUT IS HAPPENING, so consumers
// (MessageList) render the deferred copy only while `typingActive` is true and
// the fresh copy otherwise.
//
// `typingActive` flips at most twice per typing burst, so subscribing is cheap.

const TYPING_ACTIVE_WINDOW_MS = 350;

interface TypingActivityState {
  typingActive: boolean;
  markTyping: () => void;
}

let idleTimer: ReturnType<typeof setTimeout> | null = null;

export const useTypingActivityStore = create<TypingActivityState>((set, get) => ({
  typingActive: false,
  markTyping: () => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      idleTimer = null;
      set({ typingActive: false });
    }, TYPING_ACTIVE_WINDOW_MS);
    if (!get().typingActive) {
      set({ typingActive: true });
    }
  },
}));

export function markTypingActivity(): void {
  useTypingActivityStore.getState().markTyping();
}
