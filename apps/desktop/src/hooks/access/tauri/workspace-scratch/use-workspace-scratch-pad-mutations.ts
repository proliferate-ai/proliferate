import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ScratchRecord,
  ScratchWriteResult,
} from "@proliferate/product-client/host/desktop-bridge";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { workspaceScratchPadKey } from "@/hooks/access/tauri/workspace-scratch/query-keys";

interface WorkspaceScratchPadWriteInput {
  workspaceKey: string;
  content: string;
}

export function useWorkspaceScratchPadMutations(workspaceKey: string | null | undefined) {
  const queryClient = useQueryClient();
  const scratch = useProductHost().desktop?.scratch ?? null;

  const writeMutation = useMutation<
    ScratchWriteResult,
    Error,
    WorkspaceScratchPadWriteInput
  >({
    mutationFn: ({ workspaceKey: key, content }) => {
      if (!scratch) {
        throw new Error("Workspace scratch is only available in Desktop.");
      }
      return scratch.write(key, content);
    },
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
    queryClient.setQueryData<ScratchRecord>(
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
