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
        // High limit (server caps at 200): a basename can match many files, and
        // truncating the real one out would defeat the "already exists" guard
        // and risk correcting a valid path to the wrong file.
        const limit = 200;
        const response = await searchWorkspaceFiles(
          connection,
          connection.anyharnessWorkspaceId,
          basename,
          limit,
        );
        const candidatePaths = (response.results ?? []).map((result) => result.path);
        // When the result set is capped, the exact file or a second suffix match
        // may have been dropped — abstain rather than risk a wrong correction.
        return pickFuzzyPathMatch(targetPath, candidatePaths, {
          truncated: candidatePaths.length >= limit,
        });
      } catch {
        return null;
      }
    },
    [workspace],
  );
}
