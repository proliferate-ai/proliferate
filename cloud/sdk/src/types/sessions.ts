import type { components } from "../generated/openapi.js";
import type { CloudWorkspaceDetail } from "./generated.js";

export interface CloudSessionConfigState {
  version: number;
  current: Record<string, unknown>;
  available: Record<string, unknown>;
  updatedAt?: string | null;
}

export type CloudSessionProjection =
  components["schemas"]["CloudSessionProjectionResponse"];
export type CloudTranscriptItem =
  components["schemas"]["CloudTranscriptItemResponse"];
export type CloudPendingInteraction =
  components["schemas"]["CloudPendingInteractionResponse"];
export type CloudSessionSnapshot =
  components["schemas"]["CloudSessionSnapshotResponse"];
export type CloudSessionEventEnvelope =
  components["schemas"]["WorkerSessionEventEnvelope"];
export type CloudWorkspaceSnapshot = Omit<
  components["schemas"]["CloudWorkspaceSnapshotResponse"],
  "workspace"
> & {
  workspace: CloudWorkspaceDetail;
};
export type CloudTranscriptSnapshot =
  components["schemas"]["CloudTranscriptSnapshotResponse"];
