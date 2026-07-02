import { useMemo } from "react";
import { useSessionSubagentsQuery } from "@anyharness/sdk-react";
import type { ChildSubagentSummary } from "@anyharness/sdk";
import { useActiveSessionWorkspaceId } from "@/hooks/chat/derived/use-active-session-identity";
import { isPendingSessionId } from "@/stores/sessions/session-records";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import {
  assignDistinctDelegatedColorIndices,
  resolveDelegatedIdentitySeed,
} from "@/lib/domain/delegated-work/identity";
import { assignDistinctIdenticonSeeds } from "@/lib/domain/delegated-work/identicon";

export interface DelegatedAgentVisualAssignment {
  colorIndex?: number;
  shapeSalt?: number;
}

const EMPTY_ASSIGNMENT: DelegatedAgentVisualAssignment = {};

// Pure core (exported for tests): resolves one sibling's color/shape from the
// parent's ordered children. Subagents are the prefix of the header's merged
// child list, so this matches the tab/strip assignment for every subagent.
// The lookup leans on the server-enforced uniqueness of sessionLinkId within
// a parent: a duplicated link would collapse to its first occurrence here
// while the positional passes number every row, breaking the cross-surface
// agreement this hook exists to provide.
export function delegatedAgentVisualAssignmentFromChildren(
  children:
    | readonly Pick<ChildSubagentSummary, "sessionLinkId" | "childSessionId">[]
    | undefined,
  sessionLinkId: string | null | undefined,
): DelegatedAgentVisualAssignment {
  if (!children || !sessionLinkId) {
    return EMPTY_ASSIGNMENT;
  }
  const targetIndex = children.findIndex((child) => child.sessionLinkId === sessionLinkId);
  if (targetIndex < 0) {
    return EMPTY_ASSIGNMENT;
  }
  const orderedSeeds = children.map((child) =>
    resolveDelegatedIdentitySeed({
      id: child.sessionLinkId,
      sessionId: child.childSessionId,
      sessionLinkId: child.sessionLinkId,
    })
  );
  const seed = orderedSeeds[targetIndex] ?? "";
  return {
    colorIndex: assignDistinctDelegatedColorIndices(orderedSeeds).get(seed),
    shapeSalt: assignDistinctIdenticonSeeds(orderedSeeds).get(seed) ?? 0,
  };
}

// Shared lookup for single-agent surfaces (receipt, tool row, creation row):
// they only know one sessionLinkId, so they ask the parent's subagents query
// — the same data the composer strip renders from — for the sibling-aware
// color/shape. Falls back to an empty assignment (per-seed hash) while the
// query loads or when the link is not among the parent's children.
export function useDelegatedAgentVisualAssignment({
  parentSessionId,
  sessionLinkId,
}: {
  parentSessionId: string | null | undefined;
  sessionLinkId: string | null | undefined;
}): DelegatedAgentVisualAssignment {
  const activeWorkspaceId = useActiveSessionWorkspaceId();
  // Hot client-keyed session ids never resolve on the runtime; query with the
  // materialized id (mirrors the composer strip).
  const materializedSessionId = useSessionDirectoryStore((state) =>
    parentSessionId
      ? state.entriesById[parentSessionId]?.materializedSessionId ?? parentSessionId
      : null);
  const query = useSessionSubagentsQuery(materializedSessionId, {
    enabled: !!materializedSessionId
      && !isPendingSessionId(materializedSessionId)
      && !!sessionLinkId,
    workspaceId: activeWorkspaceId,
  });
  const children = query.data?.children;
  return useMemo(
    () => delegatedAgentVisualAssignmentFromChildren(children, sessionLinkId),
    [children, sessionLinkId],
  );
}
