import { create } from "zustand";

interface ShortcutRevealStore {
  visible: boolean;
  setVisible: (visible: boolean) => void;
}

export const useShortcutRevealStore = create<ShortcutRevealStore>((set) => ({
  visible: false,
  setVisible: (visible) => set((state) =>
    state.visible === visible ? state : { visible }
  ),
}));
