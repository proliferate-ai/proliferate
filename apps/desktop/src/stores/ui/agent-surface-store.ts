import { create } from "zustand";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";

interface AgentSurfaceState {
  surface: AgentAuthSurface;
  setSurface: (surface: AgentAuthSurface) => void;
}

export const useAgentSurfaceStore = create<AgentSurfaceState>((set) => ({
  surface: "local",
  setSurface: (surface) => set({ surface }),
}));
