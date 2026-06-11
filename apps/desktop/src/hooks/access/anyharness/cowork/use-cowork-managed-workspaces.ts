import type { CoworkManagedWorkspaceSummary } from "@anyharness/sdk";
import { useCoworkManagedWorkspacesQuery } from "@anyharness/sdk-react";
import { isPendingSessionId } from "@/stores/sessions/session-records";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";

const EMPTY_MANAGED_WORKSPACES: CoworkManagedWorkspaceSummary[] = [];

export function useCoworkManagedWorkspaces(
  sessionId: string | null | undefined,
  enabled = true,
) {
  // The runtime only knows materialized session ids; hot client-keyed
  // sessions (client-session:<kind>:...) 404 forever (and react-query
  // retries forever) if the raw id leaks into the request.
  const materializedSessionId = useSessionDirectoryStore((state) =>
    sessionId
      ? state.entriesById[sessionId]?.materializedSessionId ?? sessionId
      : null);
  const query = useCoworkManagedWorkspacesQuery(materializedSessionId, {
    enabled: enabled && !!materializedSessionId && !isPendingSessionId(materializedSessionId),
  });

  return {
    workspaces: query.data?.workspaces ?? EMPTY_MANAGED_WORKSPACES,
    isLoading: query.isLoading,
  };
}
