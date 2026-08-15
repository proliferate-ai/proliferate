import type { ContentPart, PromptInputBlock } from "@anyharness/sdk";
import type { PromptAttachmentSnapshot } from "#product/domain/chats/composer/prompt-attachment-snapshot";
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
  /**
   * The shell the new session belongs to, when that is not the selected one.
   * An unattended pending-workspace launch materializes its session while the
   * user is looking elsewhere, so reading the current selection would write
   * the shell intent and failure recovery against the wrong workspace.
   */
  targetWorkspaceUiKey?: string | null;
  /**
   * Defaults to true. False leaves the current active session alone: the
   * session is created and its shell intent recorded, but the user's view does
   * not move to it.
   */
  activateOnCreate?: boolean;
  latencyFlowId?: string | null;
  measurementOperationId?: MeasurementOperationId | null;
  promptId?: string | null;
  launchIntentId?: string | null;
  clientSessionId?: string | null;
  /** Stable server session UUID used to resume an interrupted empty create. */
  runtimeSessionId?: string | null;
  /**
   * Fresh-renderer recovery only: once the replayed create materializes, move
   * the shell from the stale optimistic alias to the authoritative runtime id.
   */
  adoptMaterializedSessionId?: boolean;
  /** Subagent preference frozen before an interrupted empty create. */
  subagentsEnabled?: boolean;
  reuseInFlightEmptySession?: boolean;
  preferExistingCompatibleSession?: boolean;
  preserveProjectedSessionOnCreateFailure?: boolean;
  skipInitialPromptEnqueue?: boolean;
  onBeforeOptimisticPrompt?: (workspaceId: string) => Promise<void> | void;
  /**
   * Own the announcement of a create that fails after the prompt was enqueued.
   *
   * A create carrying a prompt resolves at enqueue, so the caller's own `await`
   * never sees this failure and the default announcement is the composer one:
   * "your message is still in the composer". True for a person who just typed,
   * false for a background promotion into a workspace nobody is looking at —
   * there is no composer holding that text and the toast names no workspace.
   * Callers that launch unattended pass this and announce it themselves, with
   * the workspace they know about (PRO-230 review finding 3).
   */
  onQueuedPromptFailure?: (error: unknown) => void;
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
  /** The shell the new session belongs to, when that is not the selected one. */
  targetWorkspaceUiKey?: string | null;
  /** Defaults to true. False creates the session without moving the user to it. */
  activateOnCreate?: boolean;
  latencyFlowId?: string | null;
  clientSessionId?: string | null;
  /** Stable server session UUID used to resume an interrupted empty create. */
  runtimeSessionId?: string | null;
  /** Promote a recovered optimistic shell to its runtime id after materialization. */
  adoptMaterializedSessionId?: boolean;
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
