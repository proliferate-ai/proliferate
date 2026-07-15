import { useQuery } from "@tanstack/react-query";
import type { ScratchRecord } from "@proliferate/product-client/host/desktop-bridge";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { workspaceScratchPadKey } from "@/hooks/access/tauri/workspace-scratch/query-keys";

export function useWorkspaceScratchPad(workspaceKey: string | null | undefined) {
  const scratch = useProductHost().desktop?.scratch ?? null;

  return useQuery<ScratchRecord | null>({
    queryKey: workspaceScratchPadKey(workspaceKey),
    queryFn: () => scratch && workspaceKey
      ? scratch.read(workspaceKey)
      : Promise.resolve(null),
    enabled: Boolean(workspaceKey && scratch),
    staleTime: Infinity,
  });
}
