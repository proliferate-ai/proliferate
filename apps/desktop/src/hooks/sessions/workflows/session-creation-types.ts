import type { ContentPart, PromptInputBlock } from "@anyharness/sdk";
import type { PromptAttachmentSnapshot } from "@proliferate/product-domain/chats/composer/prompt-attachment-snapshot";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";

export interface CreateSessionWithResolvedConfigOptions {
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
  skipInitialPromptEnqueue?: boolean;
  onBeforeOptimisticPrompt?: (workspaceId: string) => Promise<void> | void;
}

export interface CreateEmptySessionWithResolvedConfigOptions {
  agentKind: string;
  modelId: string;
  modeId?: string;
  launchControlValues?: Record<string, string>;
  workspaceId?: string;
  latencyFlowId?: string | null;
  clientSessionId?: string | null;
  reuseInFlightEmptySession?: boolean;
  preserveProjectedSessionOnCreateFailure?: boolean;
}
