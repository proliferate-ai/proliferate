import { create } from "zustand";

interface OrganizationStore {
  activeOrganizationId: string | null;
  activeOrganizationValidated: boolean;
  setActiveOrganizationId: (
    organizationId: string | null,
    options?: { validated?: boolean },
  ) => void;
  markActiveOrganizationIdValidated: () => void;
  clearActiveOrganizationId: () => void;
}

export const useOrganizationStore = create<OrganizationStore>((set) => ({
  activeOrganizationId: null,
  activeOrganizationValidated: false,
  setActiveOrganizationId: (organizationId, options) =>
    set({
      activeOrganizationId: organizationId,
      activeOrganizationValidated: organizationId !== null && options?.validated === true,
    }),
  markActiveOrganizationIdValidated: () => set((state) => ({
    activeOrganizationValidated: state.activeOrganizationId !== null,
  })),
  clearActiveOrganizationId: () => set({
    activeOrganizationId: null,
    activeOrganizationValidated: false,
  }),
}));
