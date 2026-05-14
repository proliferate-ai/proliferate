import type {
  CloudPendingInteraction,
  CloudSessionProjection,
  CloudSessionSnapshot,
  CloudTranscriptItem,
  CloudWorkspaceSnapshot,
} from "./sessions.js";
import type { CloudTargetDetail } from "./targets.js";
import type { CloudCommandResponse } from "./commands.js";

export type CloudLiveStreamEventName =
  | "snapshot"
  | "patch"
  | "command_status"
  | "heartbeat";

export interface CloudLiveSubscriptionOptions {
  afterSeq?: number | null;
  signal?: AbortSignal;
}

export interface CloudLiveHeartbeat {
  kind: "heartbeat";
}

export type CloudProjectionPatchKind =
  | "projection_patch"
  | "workspace_projection_patch";

export type CloudLivePatchKind =
  | CloudProjectionPatchKind
  | "target_projection_patch"
  | "command_status";

export interface CloudProjectionPatch<
  TPatch = Record<string, unknown>,
  TKind extends CloudProjectionPatchKind = CloudProjectionPatchKind,
> {
  kind: TKind;
  patch: TPatch;
}

export interface CloudSessionProjectionPatchPayload {
  targetId: string;
  sessionId: string;
  seq: number;
  eventType: string;
  session: CloudSessionProjection;
  transcriptItem?: CloudTranscriptItem | null;
  pendingInteraction?: CloudPendingInteraction | null;
}

export type CloudSessionProjectionPatch = CloudProjectionPatch<
  CloudSessionProjectionPatchPayload,
  "projection_patch"
>;

export type CloudWorkspaceProjectionPatch = CloudProjectionPatch<
  CloudSessionProjectionPatchPayload,
  "workspace_projection_patch"
>;

export interface CloudTargetPatch {
  kind: "target_projection_patch";
  target: CloudTargetDetail;
}

export interface CloudCommandStatusPatch {
  kind: "command_status";
  command: CloudCommandResponse;
}

export type CloudLivePatch<TPayload = Record<string, unknown>> =
  | CloudProjectionPatch<TPayload>
  | CloudTargetPatch
  | CloudCommandStatusPatch;

export type CloudSessionLiveEvent =
  | CloudSessionSnapshot
  | CloudSessionProjectionPatch
  | CloudCommandStatusPatch
  | CloudLiveHeartbeat;

export type CloudWorkspaceLiveEvent =
  | CloudWorkspaceSnapshot
  | CloudWorkspaceProjectionPatch
  | CloudLiveHeartbeat;

export type CloudTargetLiveEvent =
  | { target: CloudTargetDetail }
  | CloudTargetPatch
  | CloudCommandStatusPatch
  | CloudLiveHeartbeat;
