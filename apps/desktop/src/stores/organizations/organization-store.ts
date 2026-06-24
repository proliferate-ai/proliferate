import { create } from "zustand";
import { readSelectedOrganizationCookie } from "@/lib/access/browser/organization-selection-cookie";

interface OrganizationStore {
  activeOrganizationId: string | null;
  setActiveOrganizationId: (organizationId: string | null) => void;
  clearActiveOrganizationId: () => void;
}

export const useOrganizationStore = create<OrganizationStore>((set) => ({
  activeOrganizationId: readSelectedOrganizationCookie(),
  setActiveOrganizationId: (organizationId) => set({ activeOrganizationId: organizationId }),
  clearActiveOrganizationId: () => set({ activeOrganizationId: null }),
}));
