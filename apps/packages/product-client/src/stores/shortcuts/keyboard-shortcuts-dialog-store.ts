import { create } from "zustand";

interface KeyboardShortcutsDialogStore {
  open: boolean;
  setOpen: (open: boolean) => void;
}

/**
 * The keyboard-shortcuts modal is the ONLY shortcuts surface (owner rev
 * 2026-07-01: settings pane removed). It mounts once in App.tsx; the sidebar
 * account popover and the ⌘/ shortcut both open it through this store.
 */
export const useKeyboardShortcutsDialogStore = create<KeyboardShortcutsDialogStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
