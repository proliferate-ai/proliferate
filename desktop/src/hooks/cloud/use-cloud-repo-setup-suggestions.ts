import { useMemo } from "react";
import type { SetupHint } from "@anyharness/sdk";
import { useDetectRepoRootSetupQuery } from "@anyharness/sdk-react";

const EMPTY_HINTS: SetupHint[] = [];

export function useCloudRepoSetupSuggestions(repoRootId: string | null | undefined) {
  const detectionQuery = useDetectRepoRootSetupQuery({
    repoRootId: repoRootId ?? undefined,
    enabled: !!repoRootId,
  });

  const suggestedPaths = useMemo(() => {
    const hints = detectionQuery.data?.hints ?? EMPTY_HINTS;
    return Array.from(
      new Set(
        hints
          .filter((hint) => hint.category === "secret_sync" && hint.detectedFile.trim().length > 0)
          .map((hint) => hint.detectedFile.trim()),
      ),
    );
  }, [detectionQuery.data?.hints]);

  return {
    ...detectionQuery,
    suggestedPaths,
  };
}
