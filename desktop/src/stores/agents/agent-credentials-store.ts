import { create } from "zustand";

interface AgentCredentialsStore {
  restartRequired: boolean;
  markRestartRequired: () => void;
  clearRestartRequired: () => void;
}

export const useAgentCredentialsStore = create<AgentCredentialsStore>((set) => ({
  restartRequired: false,
  markRestartRequired: () => {
    set({ restartRequired: true });
  },
  clearRestartRequired: () => {
    set({ restartRequired: false });
  },
}));
