import { useCoworkArtifactQuery } from "@anyharness/sdk-react";

export function useCoworkArtifactDetail(
  workspaceId: string | null | undefined,
  artifactId: string | null | undefined,
) {
  const query = useCoworkArtifactQuery(workspaceId, artifactId, {
    enabled: Boolean(workspaceId && artifactId),
  });
  const errorMessage = query.error instanceof Error
    ? query.error.message
    : query.error
      ? String(query.error)
      : null;

  return {
    artifactDetail: query.data ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    errorMessage,
  };
}
