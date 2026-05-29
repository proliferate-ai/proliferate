import { useQuery } from "@tanstack/react-query";
import {
  readWorkspaceScratchPad,
  type WorkspaceScratchPadRecord,
} from "@/lib/access/tauri/workspace-scratch";
import { workspaceScratchPadKey } from "@/hooks/access/tauri/workspace-scratch/query-keys";

export function useWorkspaceScratchPad(workspaceKey: string | null | undefined) {
  return useQuery<WorkspaceScratchPadRecord>({
    queryKey: workspaceScratchPadKey(workspaceKey),
    queryFn: () => readWorkspaceScratchPad(workspaceKey!),
    enabled: Boolean(workspaceKey),
    staleTime: Infinity,
  });
}
