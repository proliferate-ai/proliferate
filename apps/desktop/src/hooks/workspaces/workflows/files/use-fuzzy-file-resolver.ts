import { useCallback } from "react";
import {
  resolveWorkspaceConnectionFromContext,
  useAnyHarnessWorkspaceContext,
} from "@anyharness/sdk-react";
import { searchWorkspaceFiles } from "@/lib/access/anyharness/workspace-file-transport";
import { splitPathLineSuffix } from "@/lib/domain/files/path-detection";
import { pickFuzzyPathMatch } from "@/lib/domain/files/path-references";

/**
 * Backstop for slightly-wrong file references: when a workspace path does not
 * resolve to a real file (e.g. an agent dropped leading directories, producing
 * `content/ui/MarkdownRenderer.tsx` instead of the full path), search by
 * basename and return the unique workspace file whose path ends with the given
 * suffix. Best-effort — returns null when the path already exists, the match is
 * ambiguous, or the search fails. Runs lazily on open, never per render.
 */
export function useFuzzyFileResolver() {
  const workspace = useAnyHarnessWorkspaceContext();
  return useCallback(
    async (input: {
      workspacePath: string;
      materializedWorkspaceId: string | null;
    }): Promise<string | null> => {
      if (!input.materializedWorkspaceId) {
        return null;
      }
      const targetPath = splitPathLineSuffix(input.workspacePath).path;
      const basename = targetPath.split("/").filter(Boolean).pop();
      if (!basename) {
        return null;
      }
      try {
        const { connection } = await resolveWorkspaceConnectionFromContext(
          workspace,
          input.materializedWorkspaceId,
        );
        const response = await searchWorkspaceFiles(
          connection,
          connection.anyharnessWorkspaceId,
          basename,
        );
        return pickFuzzyPathMatch(
          targetPath,
          (response.results ?? []).map((result) => result.path),
        );
      } catch {
        return null;
      }
    },
    [workspace],
  );
}
