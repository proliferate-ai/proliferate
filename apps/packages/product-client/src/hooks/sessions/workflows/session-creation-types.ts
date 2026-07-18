import type { ContentPart, PromptInputBlock } from "@anyharness/sdk";
import type { PromptAttachmentSnapshot } from "@proliferate/product-domain/chats/composer/prompt-attachment-snapshot";
import type { MeasurementOperationId } from "#product/lib/domain/telemetry/debug-measurement-catalog";

export interface CreateSessionWithResolvedConfigOptions {
  text: string;
  blocks?: PromptInputBlock[];
  attachmentSnapshots?: PromptAttachmentSnapshot[];
  optimisticContentParts?: ContentPart[];
  agentKind: string;
  modelId: string;
  modeId?: string;
  /** Resolved mode frozen before an interrupted empty create; null means none. */
  resolvedModeId?: string | null;
  unattendedModeId?: string | null;
  launchControlValues?: Record<string, string>;
  /** Live defaults frozen before an interrupted empty create. */
  frozenLiveControlValues?: Record<string, string>;
  workspaceId?: string;
  latencyFlowId?: string | null;
  measurementOperationId?: MeasurementOperationId | null;
  promptId?: string | null;
  launchIntentId?: string | null;
  clientSessionId?: string | null;
  /** Stable server session UUID used to resume an interrupted empty create. */
  runtimeSessionId?: string | null;
  /** Subagent preference frozen before an interrupted empty create. */
  subagentsEnabled?: boolean;
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
  resolvedModeId?: string | null;
  unattendedModeId?: string | null;
  launchControlValues?: Record<string, string>;
  frozenLiveControlValues?: Record<string, string>;
  workspaceId?: string;
  latencyFlowId?: string | null;
  clientSessionId?: string | null;
  /** Stable server session UUID used to resume an interrupted empty create. */
  runtimeSessionId?: string | null;
  subagentsEnabled?: boolean;
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
