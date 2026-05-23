import type {
  ContentPart,
  PromptInputBlock,
  PromptProvenance,
  ResolveInteractionRequest,
} from "@anyharness/sdk";
import {
  clonePromptAttachmentSnapshot,
  type PromptAttachmentSnapshot,
} from "../../chats/composer/prompt-attachment-snapshot";

export type SessionIntentKind =
  | "send_prompt"
  | "update_config"
  | "resolve_interaction"
  | "edit_pending_prompt"
  | "delete_pending_prompt";

export type SessionIntentStatus =
  | "queued"
  | "preparing"
  | "dispatching"
  | "accepted"
  | "reconciled"
  | "failed"
  | "cancelled"
  | "stale";

export interface SessionIntentBase {
  intentId: string;
  kind: SessionIntentKind;
  clientSessionId: string;
  materializedSessionId: string | null;
  workspaceId: string | null;
  status: SessionIntentStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  dispatchedAt: string | null;
  acceptedAt: string | null;
  reconciledAt: string | null;
}

export type PromptOutboxDeliveryState =
  | "waiting_for_session"
  | "preparing"
  | "dispatching"
  | "accepted_running"
  | "accepted_queued"
  | "unknown_after_dispatch"
  | "failed_before_dispatch"
  | "cancelled"
  | "echoed_tombstone";

export type PromptOutboxPlacement = "transcript" | "queue";

export interface SessionSendPromptIntent extends SessionIntentBase {
  kind: "send_prompt";
  clientPromptId: string;
  retryOfPromptId: string | null;
  text: string;
  blocks: PromptInputBlock[];
  attachmentSnapshots: PromptAttachmentSnapshot[];
  contentParts: ContentPart[];
  promptProvenance: PromptProvenance | null;
  queuedSeq: number | null;
  placement: PromptOutboxPlacement;
  deliveryState: PromptOutboxDeliveryState;
  latencyFlowId: string | null;
  echoedAt: string | null;
}

export type PromptOutboxEntry = SessionSendPromptIntent;

export type SessionConfigIntentApplyState = "applied" | "queued";

export interface SessionUpdateConfigIntent extends SessionIntentBase {
  kind: "update_config";
  configId: string;
  value: string;
  applyState: SessionConfigIntentApplyState | null;
  persistDefaultPreference: boolean;
}

export type SessionInteractionIntentAction =
  | "permission"
  | "user_input"
  | "mcp_elicitation";

export interface SessionResolveInteractionIntent extends SessionIntentBase {
  kind: "resolve_interaction";
  action: SessionInteractionIntentAction;
  requestId: string;
  request: ResolveInteractionRequest;
  requestExtra: Record<string, unknown> | null;
}

export interface SessionEditPendingPromptIntent extends SessionIntentBase {
  kind: "edit_pending_prompt";
  seq: number;
  text: string;
}

export interface SessionDeletePendingPromptIntent extends SessionIntentBase {
  kind: "delete_pending_prompt";
  seq: number;
}

export type SessionIntent =
  | SessionSendPromptIntent
  | SessionUpdateConfigIntent
  | SessionResolveInteractionIntent
  | SessionEditPendingPromptIntent
  | SessionDeletePendingPromptIntent;

export interface PromptOutboxCreateInput {
  clientPromptId: string;
  retryOfPromptId?: string | null;
  clientSessionId: string;
  materializedSessionId?: string | null;
  workspaceId?: string | null;
  text: string;
  blocks: readonly PromptInputBlock[];
  attachmentSnapshots?: readonly PromptAttachmentSnapshot[];
  contentParts?: readonly ContentPart[];
  promptProvenance?: PromptProvenance | null;
  placement?: PromptOutboxPlacement;
  latencyFlowId?: string | null;
  now?: string;
}

export function createSendPromptIntent(input: PromptOutboxCreateInput): SessionSendPromptIntent {
  const now = input.now ?? new Date().toISOString();
  return {
    intentId: input.clientPromptId,
    kind: "send_prompt",
    clientPromptId: input.clientPromptId,
    retryOfPromptId: input.retryOfPromptId ?? null,
    clientSessionId: input.clientSessionId,
    materializedSessionId: input.materializedSessionId ?? null,
    workspaceId: input.workspaceId ?? null,
    text: input.text,
    blocks: input.blocks.map(clonePromptInputBlock),
    attachmentSnapshots: (input.attachmentSnapshots ?? []).map(clonePromptAttachmentSnapshot),
    contentParts: input.contentParts
      ? input.contentParts.map(cloneContentPart)
      : promptBlocksToContentParts(input.blocks),
    promptProvenance: input.promptProvenance ?? null,
    queuedSeq: null,
    placement: input.placement ?? "transcript",
    status: "queued",
    deliveryState: "waiting_for_session",
    latencyFlowId: input.latencyFlowId ?? null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    dispatchedAt: null,
    acceptedAt: null,
    reconciledAt: null,
    echoedAt: null,
  };
}

export const createPromptOutboxEntry = createSendPromptIntent;

export function createUpdateConfigIntent(input: {
  intentId: string;
  clientSessionId: string;
  materializedSessionId?: string | null;
  workspaceId?: string | null;
  configId: string;
  value: string;
  persistDefaultPreference?: boolean;
  now?: string;
}): SessionUpdateConfigIntent {
  const now = input.now ?? new Date().toISOString();
  return {
    intentId: input.intentId,
    kind: "update_config",
    clientSessionId: input.clientSessionId,
    materializedSessionId: input.materializedSessionId ?? null,
    workspaceId: input.workspaceId ?? null,
    status: "queued",
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    dispatchedAt: null,
    acceptedAt: null,
    reconciledAt: null,
    configId: input.configId,
    value: input.value,
    applyState: null,
    persistDefaultPreference: input.persistDefaultPreference ?? true,
  };
}

export function createResolveInteractionIntent(input: {
  intentId: string;
  clientSessionId: string;
  materializedSessionId?: string | null;
  workspaceId?: string | null;
  action: SessionInteractionIntentAction;
  requestId: string;
  request: ResolveInteractionRequest;
  requestExtra?: Record<string, unknown> | null;
  now?: string;
}): SessionResolveInteractionIntent {
  const now = input.now ?? new Date().toISOString();
  return {
    intentId: input.intentId,
    kind: "resolve_interaction",
    clientSessionId: input.clientSessionId,
    materializedSessionId: input.materializedSessionId ?? null,
    workspaceId: input.workspaceId ?? null,
    status: "queued",
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    dispatchedAt: null,
    acceptedAt: null,
    reconciledAt: null,
    action: input.action,
    requestId: input.requestId,
    request: input.request,
    requestExtra: input.requestExtra ?? null,
  };
}

export function createEditPendingPromptIntent(input: {
  intentId: string;
  clientSessionId: string;
  materializedSessionId?: string | null;
  workspaceId?: string | null;
  seq: number;
  text: string;
  now?: string;
}): SessionEditPendingPromptIntent {
  const now = input.now ?? new Date().toISOString();
  return {
    intentId: input.intentId,
    kind: "edit_pending_prompt",
    clientSessionId: input.clientSessionId,
    materializedSessionId: input.materializedSessionId ?? null,
    workspaceId: input.workspaceId ?? null,
    status: "queued",
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    dispatchedAt: null,
    acceptedAt: null,
    reconciledAt: null,
    seq: input.seq,
    text: input.text,
  };
}

export function createDeletePendingPromptIntent(input: {
  intentId: string;
  clientSessionId: string;
  materializedSessionId?: string | null;
  workspaceId?: string | null;
  seq: number;
  now?: string;
}): SessionDeletePendingPromptIntent {
  const now = input.now ?? new Date().toISOString();
  return {
    intentId: input.intentId,
    kind: "delete_pending_prompt",
    clientSessionId: input.clientSessionId,
    materializedSessionId: input.materializedSessionId ?? null,
    workspaceId: input.workspaceId ?? null,
    status: "queued",
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    dispatchedAt: null,
    acceptedAt: null,
    reconciledAt: null,
    seq: input.seq,
  };
}

export function isOutboxEntryTerminal(entry: PromptOutboxEntry): boolean {
  return entry.deliveryState === "cancelled" || entry.deliveryState === "echoed_tombstone";
}

export function isSessionIntentTerminal(intent: SessionIntent): boolean {
  if (intent.kind === "send_prompt") {
    return isOutboxEntryTerminal(intent) || intent.deliveryState === "failed_before_dispatch";
  }
  return intent.status === "accepted"
    || intent.status === "reconciled"
    || intent.status === "failed"
    || intent.status === "cancelled"
    || intent.status === "stale";
}

function promptBlocksToContentParts(blocks: readonly PromptInputBlock[]): ContentPart[] {
  return blocks.flatMap((block): ContentPart[] => {
    switch (block.type) {
      case "text":
        return block.text.trim() ? [{ type: "text", text: block.text }] : [];
      case "image":
        return [];
      case "resource":
        return [{
          type: "resource",
          uri: block.uri,
          name: block.name,
          mimeType: block.mimeType,
          size: block.size,
          source: block.source,
        }];
      case "plan_reference":
        return [];
      default:
        return [];
    }
  });
}

function clonePromptInputBlock(block: PromptInputBlock): PromptInputBlock {
  return { ...block };
}

function cloneContentPart(part: ContentPart): ContentPart {
  return { ...part };
}
