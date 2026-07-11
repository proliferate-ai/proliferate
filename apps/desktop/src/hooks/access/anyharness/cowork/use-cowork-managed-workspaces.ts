import type { CoworkManagedWorkspaceSummary } from "@anyharness/sdk";
import { useCoworkManagedWorkspacesQuery } from "@anyharness/sdk-react";
import { isPendingSessionId } from "@/stores/sessions/session-records";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import {
  isReplacedSessionTombstonedInAnyWorkspace,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";

const EMPTY_MANAGED_WORKSPACES: CoworkManagedWorkspaceSummary[] = [];

export function useCoworkManagedWorkspaces(
  sessionId: string | null | undefined,
  enabled = true,
) {
  // The runtime only knows materialized session ids; hot client-keyed
  // sessions (client-session:<kind>:...) 404 forever (and react-query
  // retries forever) if the raw id leaks into the request.
  // Subscribe to the entry itself, not only its resolved id. A materialized
  // session commonly uses the same client/runtime id, so removing its entry
  // during replacement would otherwise leave the selector value unchanged and
  // the stale query observer enabled.
  const directoryEntry = useSessionDirectoryStore((state) =>
    sessionId ? state.entriesById[sessionId] ?? null : null);
  const materializedSessionId = sessionId
    ? directoryEntry?.materializedSessionId ?? sessionId
    : null;
  const query = useCoworkManagedWorkspacesQuery(materializedSessionId, {
    enabled: enabled
      && !!materializedSessionId
      && !isPendingSessionId(materializedSessionId)
      && !isReplacedSessionTombstonedInAnyWorkspace(materializedSessionId),
  });

  return {
    workspaces: query.data?.workspaces ?? EMPTY_MANAGED_WORKSPACES,
    isLoading: query.isLoading,
  };
}
