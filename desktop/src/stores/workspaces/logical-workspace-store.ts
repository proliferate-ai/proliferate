import { create } from "zustand";
import { readPersistedValue, persistValue } from "@/lib/infra/preferences-persistence";

interface LogicalWorkspaceState {
  _hydrated: boolean;
  selectedLogicalWorkspaceId: string | null;
  setSelectedLogicalWorkspaceId: (logicalWorkspaceId: string | null) => void;
}

const LOGICAL_WORKSPACE_SELECTION_KEY = "selected_logical_workspace_id";

export const useLogicalWorkspaceStore = create<LogicalWorkspaceState>((set) => ({
  _hydrated: false,
  selectedLogicalWorkspaceId: null,
  setSelectedLogicalWorkspaceId: (selectedLogicalWorkspaceId) => set({ selectedLogicalWorkspaceId }),
}));

useLogicalWorkspaceStore.subscribe((state, prev) => {
  if (!state._hydrated || state.selectedLogicalWorkspaceId === prev.selectedLogicalWorkspaceId) {
    return;
  }

  void persistValue(LOGICAL_WORKSPACE_SELECTION_KEY, state.selectedLogicalWorkspaceId);
});

export async function bootstrapLogicalWorkspaceSelection(): Promise<void> {
  const selectedLogicalWorkspaceId =
    (await readPersistedValue<string | null>(LOGICAL_WORKSPACE_SELECTION_KEY))
    ?? null;
  useLogicalWorkspaceStore.setState({
    _hydrated: true,
    selectedLogicalWorkspaceId,
  });
}
