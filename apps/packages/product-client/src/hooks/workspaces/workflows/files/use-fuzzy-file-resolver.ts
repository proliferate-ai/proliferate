import { useCallback } from "react";
import { useWorkspaceFileLookup } from "#product/hooks/access/anyharness/files/use-workspace-file-lookup";
import { fileReferenceBasename } from "#product/lib/domain/files/path-references";

export type FuzzyFileResolutionOutcome =
  | { status: "match"; workspacePath: string }
  | { status: "no-match" }
  | { status: "ambiguous" }
  | { status: "search-error" };

/** One bounded basename search; corrected stat remains owned by the action hook. */
export function useFuzzyFileResolver() {
  const { searchFiles } = useWorkspaceFileLookup();

  return useCallback(async ({
    workspacePath,
    materializedWorkspaceId,
  }: {
    workspacePath: string;
    materializedWorkspaceId: string;
  }): Promise<FuzzyFileResolutionOutcome> => {
    const basename = fileReferenceBasename(workspacePath);
    if (!basename || !workspacePath) return { status: "no-match" };

    try {
      const response = await searchFiles({ materializedWorkspaceId, query: basename });
      return fuzzyOutcome(
        workspacePath,
        (response.results ?? []).map((result) => result.path),
      );
    } catch {
      return { status: "search-error" };
    }
  }, [searchFiles]);
}

export function fuzzyOutcome(
  requestedPath: string,
  candidates: readonly string[],
): FuzzyFileResolutionOutcome {
  const requested = requestedPath.toLowerCase();
  const suffix = `/${requested}`;
  const matches = candidates.filter((candidate) => {
    const normalized = candidate.toLowerCase();
    return normalized === requested || normalized.endsWith(suffix);
  });
  if (matches.length === 0) return { status: "no-match" };
  if (matches.length > 1) return { status: "ambiguous" };
  return { status: "match", workspacePath: matches[0] };
}
