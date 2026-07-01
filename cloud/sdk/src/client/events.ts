import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type { CloudSessionEventEnvelope } from "../types/sessions.js";

export interface CloudSessionEvent {
  targetId: string;
  sessionId: string;
  seq: number;
  eventType: string;
  sourceKind?: string | null;
  turnId?: string | null;
  itemId?: string | null;
  occurredAt?: string | null;
  payload?: unknown;
  envelope?: CloudSessionEventEnvelope | null;
  [key: string]: any;
}

export interface CloudSessionEventsResponse {
  events: CloudSessionEvent[];
  nextCursor: number;
  [key: string]: any;
}

export interface ListSessionEventsInput {
  targetId: string;
  afterSeq?: number | null;
  limit?: number | null;
  signal?: AbortSignal;
}

const DEFAULT_SESSION_EVENT_PAGE_LIMIT = 200;
const MAX_SESSION_EVENT_PAGES = 50;

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

export async function listAllSessionEvents(
  sessionId: string,
  input: ListSessionEventsInput,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSessionEventsResponse> {
  const limit = input.limit ?? DEFAULT_SESSION_EVENT_PAGE_LIMIT;
  let afterSeq = input.afterSeq ?? 0;
  const events: CloudSessionEvent[] = [];

  for (let page = 0; page < MAX_SESSION_EVENT_PAGES; page += 1) {
    const response = await listSessionEvents(
      sessionId,
      {
        ...input,
        afterSeq,
        limit,
      },
      client,
    );
    events.push(...response.events);

    const nextCursor = response.nextCursor ?? null;
    if (response.events.length < limit || nextCursor === null || nextCursor <= afterSeq) {
      return {
        events,
        nextCursor,
      };
    }
    afterSeq = nextCursor;
  }

  return {
    events,
    nextCursor: afterSeq,
  };
}
