import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  CloudSessionSnapshot,
  CloudTranscriptSnapshot,
  CloudWorkspaceSnapshot,
} from "../types/index.js";

export async function getWorkspaceSnapshot(
  workspaceId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudWorkspaceSnapshot> {
  return client.requestJson<CloudWorkspaceSnapshot>({
    method: "GET",
    path: "/v1/cloud/workspaces/{workspace_id}/snapshot",
    pathParams: { workspace_id: workspaceId },
  });
}

export async function getSessionSnapshot(
  sessionId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSessionSnapshot> {
  return client.requestJson<CloudSessionSnapshot>({
    method: "GET",
    path: "/v1/cloud/sessions/{session_id}/snapshot",
    pathParams: { session_id: sessionId },
  });
}

export async function getTranscriptSnapshot(
  sessionId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudTranscriptSnapshot> {
  return client.requestJson<CloudTranscriptSnapshot>({
    method: "GET",
    path: "/v1/cloud/sessions/{session_id}/transcript",
    pathParams: { session_id: sessionId },
  });
}
