import type {
  ContentPart,
  PromptInputBlock,
  PromptProvenance,
} from "@anyharness/sdk";
import {
  clonePromptAttachmentSnapshot,
  type PromptAttachmentSnapshot,
} from "@/lib/domain/chat/composer/prompt-attachment-snapshot";

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

export interface PromptOutboxEntry {
  clientPromptId: string;
  retryOfPromptId: string | null;
  clientSessionId: string;
  materializedSessionId: string | null;
  workspaceId: string | null;
  text: string;
  blocks: PromptInputBlock[];
  attachmentSnapshots: PromptAttachmentSnapshot[];
  contentParts: ContentPart[];
  promptProvenance: PromptProvenance | null;
  queuedSeq: number | null;
  placement: PromptOutboxPlacement;
  deliveryState: PromptOutboxDeliveryState;
  latencyFlowId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  dispatchedAt: string | null;
  acceptedAt: string | null;
  echoedAt: string | null;
}

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

export function createPromptOutboxEntry(input: PromptOutboxCreateInput): PromptOutboxEntry {
  const now = input.now ?? new Date().toISOString();
  return {
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
    deliveryState: "waiting_for_session",
    latencyFlowId: input.latencyFlowId ?? null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    dispatchedAt: null,
    acceptedAt: null,
    echoedAt: null,
  };
}

export function isOutboxEntryTerminal(entry: PromptOutboxEntry): boolean {
  return entry.deliveryState === "cancelled" || entry.deliveryState === "echoed_tombstone";
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
