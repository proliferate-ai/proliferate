import type {
  ContentPart,
  PromptInputBlock,
} from "@anyharness/sdk";
import type { PromptAttachmentSnapshot } from "@proliferate/product-model/chats/composer/prompt-attachment-snapshot";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";

export interface SessionCreateWithResolvedConfigRetryOptions {
  text: string;
  blocks?: PromptInputBlock[];
  attachmentSnapshots?: PromptAttachmentSnapshot[];
  optimisticContentParts?: ContentPart[];
  agentKind: string;
  modelId: string;
  modeId?: string;
  launchControlValues?: Record<string, string>;
  workspaceId?: string;
  latencyFlowId?: string | null;
  measurementOperationId?: MeasurementOperationId | null;
  promptId?: string | null;
  launchIntentId?: string | null;
  clientSessionId?: string | null;
  reuseInFlightEmptySession?: boolean;
  preferExistingCompatibleSession?: boolean;
  preserveProjectedSessionOnCreateFailure?: boolean;
  modelAvailabilityRetryCount?: number;
  skipInitialPromptEnqueue?: boolean;
  onBeforeOptimisticPrompt?: (workspaceId: string) => Promise<void> | void;
}

export function buildModelAvailabilityRetryOptions({
  options,
  pendingSessionId,
  promptId,
  hasPrompt,
}: {
  options: SessionCreateWithResolvedConfigRetryOptions;
  pendingSessionId: string;
  promptId: string | null;
  hasPrompt: boolean;
}): SessionCreateWithResolvedConfigRetryOptions {
  return {
    ...options,
    clientSessionId: pendingSessionId,
    promptId,
    latencyFlowId: null,
    measurementOperationId: null,
    reuseInFlightEmptySession: false,
    skipInitialPromptEnqueue: hasPrompt,
  };
}
