import {
  useSessionSubagentsQuery,
  useWorkspaceSessionsQuery,
  useWorkspaceSubagentsQuery,
} from "@anyharness/sdk-react";

// The roster is fetch-once React Query with event-driven invalidation, which
// only covers sessions this client happens to stream. A parent's own actor
// (a different client, a background actor swap) can update the roster with
// nothing here to invalidate it. This modest poll is a backstop, not the
// primary freshness mechanism, and only runs while the pane is genuinely
// open/visible to a user who could see the staleness.
const AGENTS_PANE_ROSTER_POLL_MS = 15_000;

/**
 * The Agents pane's three roster data sources, with the staleness-backstop
 * poll applied while the pane is open. Split from `use-agents-pane.ts` purely
 * along the data-fetching seam to keep that facade under the documented
 * frontend file threshold.
 */
export function useAgentsPaneRosterQueries({
  workspaceId,
  parentSessionId,
  isOpen,
}: {
  workspaceId: string;
  parentSessionId: string | null;
  isOpen: boolean;
}) {
  const workspaceRosterQuery = useWorkspaceSubagentsQuery({
    workspaceId,
    enabled: true,
    refetchInterval: isOpen ? AGENTS_PANE_ROSTER_POLL_MS : false,
    refetchOnWindowFocus: isOpen,
  });
  const parentRosterQuery = useSessionSubagentsQuery(parentSessionId, {
    workspaceId,
    enabled: parentSessionId !== null,
    refetchInterval: isOpen ? AGENTS_PANE_ROSTER_POLL_MS : false,
    refetchOnWindowFocus: isOpen,
  });
  // Kept dormant until Promote-404 convergence needs an authoritative second
  // source. A 404 is never treated as success from roster absence alone.
  const workspaceSessionsQuery = useWorkspaceSessionsQuery({
    workspaceId,
    enabled: false,
  });
  return { workspaceRosterQuery, parentRosterQuery, workspaceSessionsQuery };
}
