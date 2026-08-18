import type { SessionEventEnvelope } from "@anyharness/sdk";
import type { WorkspacePinLocalOrder } from "#product/lib/domain/preferences/workspace-ui/model";
import {
  findLogicalWorkspace,
  logicalWorkspaceRelatedIds,
} from "#product/lib/domain/workspaces/cloud/logical-workspace-lookup";
import type { LogicalWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-model";

export interface WorkspacePinIntent {
  requestId: string;
  runtimeId: string;
  sessionId: string;
  seq: number;
  workspaceId: string;
  pinned: boolean;
}

export type WorkspacePinIntentProvenance = "history" | "live";

export interface ObservedWorkspacePinIntent extends WorkspacePinIntent {
  observedAt: WorkspacePinLocalOrder;
  provenance: WorkspacePinIntentProvenance;
}

export interface ResolvedWorkspacePinIntent extends ObservedWorkspacePinIntent {
  pinId: string;
  relatedIds: string[];
}

export function workspacePinIntentForEnvelope(
  envelope: SessionEventEnvelope,
): WorkspacePinIntent | null {
  const event = envelope.event;
  if (
    event.type !== "workspace_pin_intent"
    || envelope.turnId
    || envelope.itemId
    || !Number.isSafeInteger(envelope.seq)
    || envelope.seq <= 0
  ) {
    return null;
  }
  const requestId = readNonEmptyString(event.requestId);
  const runtimeId = readNonEmptyString(event.runtimeId);
  const sourceSessionId = readNonEmptyString(event.sourceSessionId);
  const workspaceId = readNonEmptyString(event.workspaceId);
  if (
    !requestId
    || !isUuidV4(requestId)
    || !runtimeId
    || !sourceSessionId
    || sourceSessionId !== envelope.sessionId
    || !workspaceId
    || typeof event.pinned !== "boolean"
  ) {
    return null;
  }
  return {
    requestId,
    runtimeId,
    sessionId: sourceSessionId,
    seq: envelope.seq,
    workspaceId,
    pinned: event.pinned,
  };
}

export function resolveWorkspacePinIntent(
  intent: ObservedWorkspacePinIntent,
  logicalWorkspaces: readonly LogicalWorkspace[],
): ResolvedWorkspacePinIntent | null {
  const logicalWorkspace = findLogicalWorkspace(logicalWorkspaces, intent.workspaceId);
  if (!logicalWorkspace) {
    return null;
  }
  return {
    ...intent,
    pinId: logicalWorkspace.id,
    relatedIds: logicalWorkspaceRelatedIds(logicalWorkspace),
  };
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isUuidV4(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
