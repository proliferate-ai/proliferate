import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type { components } from "../generated/openapi.js";

export type CloudSessionEvent =
  components["schemas"]["CloudSessionEventResponse"];
export type CloudSessionEventsResponse =
  components["schemas"]["CloudSessionEventsResponse"];

export interface ListSessionEventsInput {
  targetId: string;
  afterSeq?: number | null;
  limit?: number | null;
  signal?: AbortSignal;
}

export async function listSessionEvents(
  sessionId: string,
  input: ListSessionEventsInput,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSessionEventsResponse> {
  return client.requestJson<CloudSessionEventsResponse>({
    method: "GET",
    path: "/v1/cloud/sessions/{session_id}/events",
    pathParams: { session_id: sessionId },
    query: {
      targetId: input.targetId,
      afterSeq: input.afterSeq ?? undefined,
      limit: input.limit ?? undefined,
    },
    signal: input.signal,
  });
}
