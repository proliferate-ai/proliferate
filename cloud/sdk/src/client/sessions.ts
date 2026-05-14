import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  CloudSessionSnapshot,
  CloudTranscriptSnapshot,
  CloudWorkspaceSnapshot,
} from "../types/index.js";

export interface CloudSnapshotRequestOptions {
  signal?: AbortSignal;
}

export interface CloudSessionSnapshotInput extends CloudSnapshotRequestOptions {
  targetId: string;
}

export function getWorkspaceSnapshot(
  workspaceId: string,
  client?: ProliferateCloudClient,
): Promise<CloudWorkspaceSnapshot>;
export function getWorkspaceSnapshot(
  workspaceId: string,
  input?: CloudSnapshotRequestOptions,
  client?: ProliferateCloudClient,
): Promise<CloudWorkspaceSnapshot>;
export async function getWorkspaceSnapshot(
  workspaceId: string,
  inputOrClient?: CloudSnapshotRequestOptions | ProliferateCloudClient,
  client?: ProliferateCloudClient,
): Promise<CloudWorkspaceSnapshot> {
  const [input, resolvedClient] = resolveSnapshotClient(inputOrClient, client);
  return resolvedClient.requestJson<CloudWorkspaceSnapshot>({
    method: "GET",
    path: "/v1/cloud/workspaces/{workspace_id}/snapshot",
    pathParams: { workspace_id: workspaceId },
    signal: input?.signal,
  });
}

export async function getSessionSnapshot(
  sessionId: string,
  input: CloudSessionSnapshotInput,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSessionSnapshot> {
  return client.requestJson<CloudSessionSnapshot>({
    method: "GET",
    path: "/v1/cloud/sessions/{session_id}/snapshot",
    pathParams: { session_id: sessionId },
    query: { targetId: input.targetId },
    signal: input.signal,
  });
}

export async function getTranscriptSnapshot(
  sessionId: string,
  input: CloudSessionSnapshotInput,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudTranscriptSnapshot> {
  return client.requestJson<CloudTranscriptSnapshot>({
    method: "GET",
    path: "/v1/cloud/sessions/{session_id}/transcript",
    pathParams: { session_id: sessionId },
    query: { targetId: input.targetId },
    signal: input.signal,
  });
}

function resolveSnapshotClient(
  inputOrClient: CloudSnapshotRequestOptions | ProliferateCloudClient | undefined,
  client: ProliferateCloudClient | undefined,
): [CloudSnapshotRequestOptions | undefined, ProliferateCloudClient] {
  if (isProliferateCloudClient(inputOrClient)) {
    return [undefined, inputOrClient];
  }
  return [inputOrClient, client ?? getProliferateClient()];
}

function isProliferateCloudClient(value: unknown): value is ProliferateCloudClient {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { requestJson?: unknown }).requestJson === "function"
  );
}
