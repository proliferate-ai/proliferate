import { getProliferateClient } from "./core";
import type {
  CloudSessionSnapshot,
  CloudTranscriptSnapshot,
  CloudWorkspaceSnapshot,
} from "../types";

export async function getWorkspaceSnapshot(
  workspaceId: string,
): Promise<CloudWorkspaceSnapshot> {
  return getProliferateClient().requestJson<CloudWorkspaceSnapshot>({
    method: "GET",
    path: "/v1/cloud/workspaces/{workspace_id}/snapshot",
    pathParams: { workspace_id: workspaceId },
  });
}

export async function getSessionSnapshot(
  sessionId: string,
): Promise<CloudSessionSnapshot> {
  return getProliferateClient().requestJson<CloudSessionSnapshot>({
    method: "GET",
    path: "/v1/cloud/sessions/{session_id}/snapshot",
    pathParams: { session_id: sessionId },
  });
}

export async function getTranscriptSnapshot(
  sessionId: string,
): Promise<CloudTranscriptSnapshot> {
  return getProliferateClient().requestJson<CloudTranscriptSnapshot>({
    method: "GET",
    path: "/v1/cloud/sessions/{session_id}/transcript",
    pathParams: { session_id: sessionId },
  });
}

