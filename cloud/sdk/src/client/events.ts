import { getProliferateClient, type ProliferateCloudClient } from "./core.js";

export interface CloudSessionEvent {
  id: string;
  targetId: string;
  workspaceId: string;
  sessionId: string;
  anyharnessSeq: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt?: string | null;
}

export interface CloudSessionEventsResponse {
  events: CloudSessionEvent[];
  nextCursor?: string | null;
}

export async function listSessionEvents(
  sessionId: string,
  input?: { cursor?: string | null; limit?: number | null; signal?: AbortSignal },
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSessionEventsResponse> {
  return client.requestJson<CloudSessionEventsResponse>({
    method: "GET",
    path: "/v1/cloud/sessions/{session_id}/events",
    pathParams: { session_id: sessionId },
    query: {
      cursor: input?.cursor ?? undefined,
      limit: input?.limit ?? undefined,
    },
    signal: input?.signal,
  });
}
