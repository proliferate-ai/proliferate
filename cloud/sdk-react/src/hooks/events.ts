import { useQuery } from "@tanstack/react-query";
import {
  listSessionEvents,
  type CloudSessionEventsResponse,
} from "@proliferate/cloud-sdk";
import { cloudRootKey } from "../lib/query-keys";

export function cloudSessionEventsKey(sessionId: string | null) {
  return [...cloudRootKey(), "session-events", sessionId] as const;
}

export function useCloudSessionEvents(sessionId: string | null, enabled = true) {
  return useQuery<CloudSessionEventsResponse>({
    queryKey: cloudSessionEventsKey(sessionId),
    queryFn: () => listSessionEvents(sessionId!),
    enabled: enabled && sessionId !== null,
  });
}

