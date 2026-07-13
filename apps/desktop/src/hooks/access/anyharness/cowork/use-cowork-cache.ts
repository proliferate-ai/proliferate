import {
  anyHarnessCoworkArtifactKey,
  anyHarnessCoworkManagedWorkspacesKey,
  anyHarnessCoworkManifestKey,
  anyHarnessCoworkStatusKey,
  anyHarnessCoworkThreadsKey,
  useAnyHarnessCacheScopeKey,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

export function useCoworkCache() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const cacheScopeKey = useAnyHarnessCacheScopeKey();

  const invalidateCoworkThreads = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: anyHarnessCoworkThreadsKey(runtimeUrl, cacheScopeKey),
    });
  }, [cacheScopeKey, queryClient, runtimeUrl]);

  const invalidateCoworkStatus = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: anyHarnessCoworkStatusKey(runtimeUrl, cacheScopeKey),
    });
  }, [cacheScopeKey, queryClient, runtimeUrl]);

  const invalidateCoworkManagedWorkspaces = useCallback(async (parentSessionId: string) => {
    await queryClient.invalidateQueries({
      queryKey: anyHarnessCoworkManagedWorkspacesKey(
        runtimeUrl,
        parentSessionId,
        cacheScopeKey,
      ),
    });
  }, [cacheScopeKey, queryClient, runtimeUrl]);

  const invalidateCoworkArtifactManifest = useCallback(async (workspaceId: string) => {
    await queryClient.invalidateQueries({
      queryKey: anyHarnessCoworkManifestKey(runtimeUrl, workspaceId, cacheScopeKey),
    });
  }, [cacheScopeKey, queryClient, runtimeUrl]);

  const invalidateCoworkArtifact = useCallback(async (
    workspaceId: string,
    artifactId: string,
  ) => {
    await queryClient.invalidateQueries({
      queryKey: anyHarnessCoworkArtifactKey(
        runtimeUrl,
        workspaceId,
        artifactId,
        cacheScopeKey,
      ),
    });
  }, [cacheScopeKey, queryClient, runtimeUrl]);

  return {
    invalidateCoworkArtifact,
    invalidateCoworkArtifactManifest,
    invalidateCoworkManagedWorkspaces,
    invalidateCoworkStatus,
    invalidateCoworkThreads,
  };
}
