import { useCallback } from "react";
import { AnyHarnessError } from "@anyharness/sdk";
import {
  resolveWorkspaceConnectionFromContext,
  useAnyHarnessWorkspaceContext,
  useWriteWorkspaceFileMutation,
} from "@anyharness/sdk-react";
import { useWorkspaceFilesCache } from "@/hooks/access/anyharness/files/use-workspace-files-cache";
import type { WorkspaceFileContext } from "@/hooks/workspaces/derived/files/use-workspace-file-context";
import { useWorkspaceFileBuffersStore } from "@/stores/editor/workspace-file-buffers-store";

export function useWorkspaceFileBufferActions(fileContext: WorkspaceFileContext) {
  const workspace = useAnyHarnessWorkspaceContext();
  const { reloadWorkspaceFile } = useWorkspaceFilesCache();
  const setBufferSaveState = useWorkspaceFileBuffersStore((state) => state.setBufferSaveState);
  const applyFileSave = useWorkspaceFileBuffersStore((state) => state.applyFileSave);
  const replaceBufferFromRead = useWorkspaceFileBuffersStore((state) => state.replaceBufferFromRead);
  const writeMutation = useWriteWorkspaceFileMutation({
    workspaceId: fileContext.materializedWorkspaceId,
  });

  const saveFile = useCallback(async (filePath: string) => {
    const buffer = useWorkspaceFileBuffersStore.getState().buffersByPath[filePath];
    if (
      !buffer
      || !buffer.isDirty
      || buffer.localContent === null
      || !buffer.baseVersionToken
    ) {
      return;
    }
    setBufferSaveState(filePath, "saving");
    try {
      const result = await writeMutation.mutateAsync({
        path: filePath,
        content: buffer.localContent,
        expectedVersionToken: buffer.baseVersionToken,
      });
      applyFileSave(filePath, result.versionToken, buffer.localContent);
    } catch (error) {
      const isConflict =
        error instanceof AnyHarnessError
        && error.problem.code === "VERSION_MISMATCH";
      setBufferSaveState(filePath, isConflict ? "conflict" : "error", String(error));
    }
  }, [applyFileSave, setBufferSaveState, writeMutation]);

  const reloadFile = useCallback(async (filePath: string) => {
    if (!fileContext.materializedWorkspaceId) {
      return;
    }
    const resolved = await resolveWorkspaceConnectionFromContext(
      workspace,
      fileContext.materializedWorkspaceId,
    );
    const read = await reloadWorkspaceFile({
      materializedWorkspaceId: fileContext.materializedWorkspaceId,
      anyharnessWorkspaceId: resolved.connection.anyharnessWorkspaceId,
      runtimeUrl: resolved.connection.runtimeUrl,
      authToken: resolved.connection.authToken,
      filePath,
    });
    replaceBufferFromRead(filePath, read);
  }, [
    fileContext.materializedWorkspaceId,
    reloadWorkspaceFile,
    replaceBufferFromRead,
    workspace,
  ]);

  return {
    saveFile,
    reloadFile,
  };
}
