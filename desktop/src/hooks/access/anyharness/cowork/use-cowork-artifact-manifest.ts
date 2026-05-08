import type { CoworkArtifactSummary } from "@anyharness/sdk";
import { useCoworkArtifactManifestQuery } from "@anyharness/sdk-react";

const EMPTY_ARTIFACTS: CoworkArtifactSummary[] = [];

export function useCoworkArtifactManifest(workspaceId: string | null | undefined) {
  const query = useCoworkArtifactManifestQuery(workspaceId, {
    enabled: Boolean(workspaceId),
  });

  return {
    manifest: query.data ?? null,
    artifacts: query.data?.artifacts ?? EMPTY_ARTIFACTS,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  };
}
