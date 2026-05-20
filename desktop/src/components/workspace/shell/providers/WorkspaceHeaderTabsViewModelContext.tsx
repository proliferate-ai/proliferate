import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useWorkspaceHeaderTabsViewModel } from "@/hooks/workspaces/tabs/use-workspace-header-tabs-view-model";

type WorkspaceHeaderTabsViewModel = ReturnType<typeof useWorkspaceHeaderTabsViewModel>;
type WorkspaceContentTabsViewModel = Pick<
  WorkspaceHeaderTabsViewModel,
  | "activeShellTab"
  | "activeShellTabKey"
  | "activation"
  | "selectedWorkspaceId"
  | "workspaceUiKey"
  | "materializedWorkspaceId"
  | "visibleChatSessionIds"
  | "liveChatSessionIds"
  | "childToParent"
  | "shellRows"
  | "orderedTabs"
>;

const WorkspaceHeaderTabsViewModelContext =
  createContext<WorkspaceHeaderTabsViewModel | null>(null);
const WorkspaceContentTabsViewModelContext =
  createContext<WorkspaceContentTabsViewModel | null>(null);

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
  const contentViewModel = useMemo<WorkspaceContentTabsViewModel>(() => ({
    activeShellTab: viewModel.activeShellTab,
    activeShellTabKey: viewModel.activeShellTabKey,
    activation: viewModel.activation,
    selectedWorkspaceId: viewModel.selectedWorkspaceId,
    workspaceUiKey: viewModel.workspaceUiKey,
    materializedWorkspaceId: viewModel.materializedWorkspaceId,
    visibleChatSessionIds: viewModel.visibleChatSessionIds,
    liveChatSessionIds: viewModel.liveChatSessionIds,
    childToParent: viewModel.childToParent,
    shellRows: viewModel.shellRows,
    orderedTabs: viewModel.orderedTabs,
  }), [
    viewModel.activeShellTab,
    viewModel.activeShellTabKey,
    viewModel.activation,
    viewModel.childToParent,
    viewModel.liveChatSessionIds,
    viewModel.materializedWorkspaceId,
    viewModel.orderedTabs,
    viewModel.selectedWorkspaceId,
    viewModel.shellRows,
    viewModel.visibleChatSessionIds,
    viewModel.workspaceUiKey,
  ]);

  return (
    <WorkspaceHeaderTabsViewModelContext.Provider value={viewModel}>
      <WorkspaceContentTabsViewModelContext.Provider value={contentViewModel}>
        {children}
      </WorkspaceContentTabsViewModelContext.Provider>
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

export function useOptionalWorkspaceHeaderTabsViewModelContext(): WorkspaceHeaderTabsViewModel | null {
  return useContext(WorkspaceHeaderTabsViewModelContext);
}

export function useWorkspaceContentTabsViewModelContext(): WorkspaceContentTabsViewModel {
  const viewModel = useContext(WorkspaceContentTabsViewModelContext);
  if (!viewModel) {
    throw new Error(
      "useWorkspaceContentTabsViewModelContext must be used inside WorkspaceHeaderTabsViewModelProvider",
    );
  }
  return viewModel;
}
