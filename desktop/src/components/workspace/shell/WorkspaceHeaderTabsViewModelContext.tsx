import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { useWorkspaceHeaderTabsViewModel } from "@/hooks/workspaces/tabs/use-workspace-header-tabs-view-model";

type WorkspaceHeaderTabsViewModel = ReturnType<typeof useWorkspaceHeaderTabsViewModel>;

const WorkspaceHeaderTabsViewModelContext =
  createContext<WorkspaceHeaderTabsViewModel | null>(null);

interface WorkspaceHeaderTabsViewModelProviderProps {
  children: ReactNode;
  enabled?: boolean;
}

export function WorkspaceHeaderTabsViewModelProvider({
  children,
  enabled = true,
}: WorkspaceHeaderTabsViewModelProviderProps) {
  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <EnabledWorkspaceHeaderTabsViewModelProvider>
      {children}
    </EnabledWorkspaceHeaderTabsViewModelProvider>
  );
}

function EnabledWorkspaceHeaderTabsViewModelProvider({
  children,
}: {
  children: ReactNode;
}) {
  const viewModel = useWorkspaceHeaderTabsViewModel();

  return (
    <WorkspaceHeaderTabsViewModelContext.Provider value={viewModel}>
      {children}
    </WorkspaceHeaderTabsViewModelContext.Provider>
  );
}

export function useWorkspaceHeaderTabsViewModelContext(): WorkspaceHeaderTabsViewModel {
  const viewModel = useContext(WorkspaceHeaderTabsViewModelContext);
  if (!viewModel) {
    throw new Error(
      "useWorkspaceHeaderTabsViewModelContext must be used inside WorkspaceHeaderTabsViewModelProvider",
    );
  }
  return viewModel;
}
