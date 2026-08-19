import { useWorkspaceQuery } from "@anyharness/sdk-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  normalizeRuntimeWorkspaceRoot,
  type RuntimeWorkspaceRootState,
  type WorkspaceFilesystemOriginState,
} from "#product/lib/domain/files/path-references";
import { resolveSelectedWorkspaceIdentity } from "#product/lib/domain/workspaces/selection/workspace-ui-key";
import { useProductWorkspaceConnectionResolver } from "#product/providers/ProductWorkspaceConnectionProvider";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

export interface WorkspacePathContextValue {
  materializedWorkspaceId: string | null;
  filesystemOrigin: WorkspaceFilesystemOriginState;
  workspaceRoot: RuntimeWorkspaceRootState;
}

const PENDING_FILESYSTEM_ORIGIN: WorkspaceFilesystemOriginState = {
  status: "pending",
  origin: null,
};
const PENDING_WORKSPACE_ROOT: RuntimeWorkspaceRootState = {
  status: "pending",
  path: null,
};

const WorkspacePathContext = createContext<WorkspacePathContextValue>({
  materializedWorkspaceId: null,
  filesystemOrigin: PENDING_FILESYSTEM_ORIGIN,
  workspaceRoot: PENDING_WORKSPACE_ROOT,
});

interface OriginResolution {
  materializedWorkspaceId: string | null;
  state: WorkspaceFilesystemOriginState;
}

export function WorkspacePathProvider({ children }: { children: ReactNode }) {
  const resolveConnection = useProductWorkspaceConnectionResolver();
  const selectedWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedWorkspaceId,
  );
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const { materializedWorkspaceId } = resolveSelectedWorkspaceIdentity({
    selectedLogicalWorkspaceId,
    materializedWorkspaceId: selectedWorkspaceId,
  });
  const workspaceQuery = useWorkspaceQuery({
    workspaceId: materializedWorkspaceId,
    enabled: materializedWorkspaceId !== null,
  });
  const [originResolution, setOriginResolution] = useState<OriginResolution>({
    materializedWorkspaceId: null,
    state: PENDING_FILESYSTEM_ORIGIN,
  });

  useEffect(() => {
    let current = true;
    setOriginResolution({
      materializedWorkspaceId,
      state: PENDING_FILESYSTEM_ORIGIN,
    });
    if (materializedWorkspaceId === null) {
      return () => {
        current = false;
      };
    }

    void resolveConnection(materializedWorkspaceId).then(
      (resolved) => {
        if (!current) return;
        setOriginResolution({
          materializedWorkspaceId,
          state: {
            status: "settled",
            origin: resolved.filesystemOrigin,
          },
        });
      },
      () => {
        if (!current) return;
        setOriginResolution({
          materializedWorkspaceId,
          state: { status: "rejected", origin: null },
        });
      },
    );

    return () => {
      current = false;
    };
  }, [materializedWorkspaceId, resolveConnection]);

  const filesystemOrigin = originResolution.materializedWorkspaceId === materializedWorkspaceId
    ? originResolution.state
    : PENDING_FILESYSTEM_ORIGIN;
  const workspaceRoot = useMemo<RuntimeWorkspaceRootState>(() => {
    if (materializedWorkspaceId === null || workspaceQuery.isPending) {
      return PENDING_WORKSPACE_ROOT;
    }
    if (workspaceQuery.isError) {
      return { status: "unavailable", path: null };
    }
    const path = normalizeRuntimeWorkspaceRoot(workspaceQuery.data?.path);
    return path === null
      ? { status: "unavailable", path: null }
      : { status: "settled", path };
  }, [materializedWorkspaceId, workspaceQuery.data?.path, workspaceQuery.isError, workspaceQuery.isPending]);
  const value = useMemo<WorkspacePathContextValue>(() => ({
    materializedWorkspaceId,
    filesystemOrigin,
    workspaceRoot,
  }), [filesystemOrigin, materializedWorkspaceId, workspaceRoot]);

  return (
    <WorkspacePathContext.Provider value={value}>
      {children}
    </WorkspacePathContext.Provider>
  );
}

export function useWorkspacePath(): WorkspacePathContextValue {
  return useContext(WorkspacePathContext);
}
