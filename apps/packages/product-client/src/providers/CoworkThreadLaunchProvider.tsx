import type { Workspace } from "@anyharness/sdk";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useCoworkThreadWorkflow } from "#product/hooks/cowork/workflows/use-cowork-thread-workflow";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import { useShortcutHandler } from "#product/hooks/shortcuts/lifecycle/use-shortcut-handler";
import { resolveWorkspaceShellSurface } from "#product/lib/domain/workspaces/shell/shell-surface";
import { ownsCoworkNewThreadShortcut } from "#product/lib/domain/cowork/new-thread-shortcut";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

type CreateCoworkThreadFromSelection = ReturnType<
  typeof useCoworkThreadWorkflow
>["createThreadFromSelection"];

interface CoworkThreadLaunchContextValue {
  desktopTargetsAvailable: boolean;
  createThreadFromSelection: CreateCoworkThreadFromSelection;
}

const CoworkThreadLaunchContext = createContext<
  CoworkThreadLaunchContextValue | undefined
>(undefined);

const unavailableCoworkThreadLaunch: CreateCoworkThreadFromSelection = async () => null;
const WEB_COWORK_THREAD_LAUNCH_CONTEXT: CoworkThreadLaunchContextValue = {
  desktopTargetsAvailable: false,
  createThreadFromSelection: unavailableCoworkThreadLaunch,
};

export function CoworkThreadLaunchProvider({ children }: { children: ReactNode }) {
  return useProductHost().desktop === null
    ? (
      <CoworkThreadLaunchContext.Provider value={WEB_COWORK_THREAD_LAUNCH_CONTEXT}>
        {children}
      </CoworkThreadLaunchContext.Provider>
    )
    : <DesktopCoworkThreadLaunchProvider>{children}</DesktopCoworkThreadLaunchProvider>;
}

function DesktopCoworkThreadLaunchProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const { data: workspaceCollections } = useWorkspaces();
  const workspaces = workspaceCollections?.workspaces ?? EMPTY_WORKSPACES;
  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces],
  );
  const { createThread, createThreadFromSelection } = useCoworkThreadWorkflow();
  const ownsNewThreadShortcut = ownsCoworkNewThreadShortcut(
    location.pathname,
    resolveWorkspaceShellSurface(selectedWorkspace, pendingWorkspaceEntry),
  );

  useShortcutHandler(
    "workspace.new-default",
    () => {
      void createThread();
    },
    { enabled: ownsNewThreadShortcut, priority: "contextual" },
  );

  const value = useMemo(
    () => ({ desktopTargetsAvailable: true, createThreadFromSelection }),
    [createThreadFromSelection],
  );
  return (
    <CoworkThreadLaunchContext.Provider value={value}>
      {children}
    </CoworkThreadLaunchContext.Provider>
  );
}

const EMPTY_WORKSPACES: Workspace[] = [];

export function useCoworkThreadLaunchContext(): CoworkThreadLaunchContextValue {
  const value = useContext(CoworkThreadLaunchContext);
  if (!value) {
    throw new Error(
      "useCoworkThreadLaunchContext must be used inside CoworkThreadLaunchProvider",
    );
  }
  return value;
}
