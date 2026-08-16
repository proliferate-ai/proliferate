import { create } from "zustand";

/**
 * Preview cursor for held-key workspace traversal (Cmd+Opt+Arrow).
 *
 * A full workspace selection commit costs ~150-250ms of main-thread work, so
 * committing one per keydown makes a held arrow queue up and replay after the
 * key is released. Instead, held traversal moves this lightweight cursor
 * through the sidebar: while `cursorId` is set it, not the committed selection,
 * drives the row highlight, so stepping between rows costs only the two row
 * re-renders whose displayed-active state flips. The expensive selection
 * commits once, after movement settles, and the commit path then clears the
 * cursor.
 *
 * Rows read this with a per-row selector that folds their own id and their
 * committed `active` prop into a single boolean (see WorkspaceItem), so a
 * cursor step re-renders exactly the two rows whose displayed state changes and
 * nothing else subscribes to the raw `cursorId`.
 */
interface SidebarSwitchCursorState {
  /** Previewed row during a held traversal, or null when idle. */
  cursorId: string | null;
  setCursor: (cursorId: string | null) => void;
}

export const useSidebarSwitchCursorStore = create<SidebarSwitchCursorState>((set) => ({
  cursorId: null,
  setCursor: (cursorId) => set((state) => (state.cursorId === cursorId ? state : { cursorId })),
}));
