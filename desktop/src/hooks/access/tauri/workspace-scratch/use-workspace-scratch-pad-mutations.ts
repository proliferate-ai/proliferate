import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  writeWorkspaceScratchPad,
  type WorkspaceScratchPadRecord,
  type WorkspaceScratchPadWriteResult,
} from "@/lib/access/tauri/workspace-scratch";
import { workspaceScratchPadKey } from "@/hooks/access/tauri/workspace-scratch/query-keys";

interface WorkspaceScratchPadWriteInput {
  workspaceKey: string;
  content: string;
}

export function useWorkspaceScratchPadMutations(workspaceKey: string | null | undefined) {
  const queryClient = useQueryClient();

  const writeMutation = useMutation<
    WorkspaceScratchPadWriteResult,
    Error,
    WorkspaceScratchPadWriteInput
  >({
    mutationFn: ({ workspaceKey: key, content }) => writeWorkspaceScratchPad(key, content),
  });
  const { mutateAsync } = writeMutation;

  const writeScratchPad = useCallback((content: string, keyOverride?: string | null) => {
    const key = keyOverride ?? workspaceKey;
    if (!key) {
      throw new Error("workspace_key_required");
    }
    return mutateAsync({ workspaceKey: key, content });
  }, [mutateAsync, workspaceKey]);

  const setScratchPadCache = useCallback((
    content: string,
    updatedAtMs: number | null,
    keyOverride?: string | null,
  ) => {
    const key = keyOverride ?? workspaceKey;
    if (!key) {
      return;
    }
    queryClient.setQueryData<WorkspaceScratchPadRecord>(
      workspaceScratchPadKey(key),
      {
        content,
        updatedAtMs,
      },
    );
  }, [queryClient, workspaceKey]);

  return {
    writeScratchPad,
    writeScratchPadState: writeMutation,
    setScratchPadCache,
  };
}
