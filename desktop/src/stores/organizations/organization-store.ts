import { create } from "zustand";

interface OrganizationStore {
  activeOrganizationId: string | null;
  setActiveOrganizationId: (organizationId: string | null) => void;
  clearActiveOrganizationId: () => void;
}

export const useOrganizationStore = create<OrganizationStore>((set) => ({
  activeOrganizationId: null,
  setActiveOrganizationId: (organizationId) => set({ activeOrganizationId: organizationId }),
  clearActiveOrganizationId: () => set({ activeOrganizationId: null }),
}));
