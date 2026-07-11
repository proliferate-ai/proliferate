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
  /**
   * When set, the creation workflow immediately hides this unused session
   * after activating the optimistic replacement. Destructive cleanup and
   * runtime dismissal commit only after the replacement materializes; failure
   * restores the captured session shell.
   */
  replacesSessionId?: string | null;
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
  /**
   * When set, the creation workflow immediately hides this unused session
   * after activating the optimistic replacement. Destructive cleanup and
   * runtime dismissal commit only after the replacement materializes; failure
   * restores the captured session shell.
   */
  replacesSessionId?: string | null;
}
