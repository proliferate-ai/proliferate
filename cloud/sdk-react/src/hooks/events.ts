import { useQuery } from "@tanstack/react-query";
import {
  listAllSessionEvents,
  type CloudSessionEventsResponse,
} from "@proliferate/cloud-sdk";
import { cloudRootKey } from "../lib/query-keys.js";
import { useCloudClient } from "../context/CloudClientProvider.js";

export function cloudSessionEventsKey(targetId: string | null, sessionId: string | null) {
  return [...cloudRootKey(), "session-events", targetId, sessionId] as const;
}

export function useCloudSessionEvents(
  targetId: string | null,
  sessionId: string | null,
  enabled = true,
) {
  const client = useCloudClient();
  const canQuery =
    enabled &&
    targetId !== null &&
    targetId !== undefined &&
    sessionId !== null &&
    sessionId !== undefined;
  return useQuery<CloudSessionEventsResponse>({
    queryKey: cloudSessionEventsKey(targetId, sessionId),
    queryFn: () => listAllSessionEvents(sessionId!, { targetId: targetId! }, client),
    enabled: canQuery,
  });
}
