export interface SessionEventEnvelope {
  sessionId: string;
  seq: number;
  timestamp: string;
  turnId?: string | null;
  itemId?: string | null;
  event: SessionEvent;
}

export interface SessionRawNotificationEnvelope {
  sessionId: string;
  seq: number;
  timestamp: string;
  notificationKind: string;
  notification: unknown;
}

export type SessionEvent =
  | SessionStartedEvent
  | SessionEndedEvent
  | TurnStartedEvent
  | TurnEndedEvent
  | ItemStartedEvent
  | ItemDeltaEvent
  | ItemCompletedEvent
  | AvailableCommandsUpdateEvent
  | CurrentModeUpdateEvent
  | ConfigOptionUpdateEvent
  | SessionStateUpdateEvent
  | SessionInfoUpdateEvent
  | UsageUpdateEvent
  | PermissionRequestedEvent
  | PermissionResolvedEvent
  | ErrorEvent;

export interface SessionStartedEvent {
  type: "session_started";
  nativeSessionId: string;
  sourceAgentKind: string;
}

export interface SessionEndedEvent {
  type: "session_ended";
  reason: SessionEndReason;
}

export type SessionEndReason = "closed" | "error";

export interface TurnStartedEvent {
  type: "turn_started";
}

export interface TurnEndedEvent {
  type: "turn_ended";
  stopReason: StopReason;
}

export type StopReason =
  | "end_turn"
  | "max_tokens"
  | "max_turn_requests"
  | "refusal"
  | "cancelled";

export interface ItemStartedEvent {
  type: "item_started";
  item: TranscriptItemPayload;
}

export interface ItemDeltaEvent {
  type: "item_delta";
  delta: TranscriptItemDeltaPayload;
}

export interface ItemCompletedEvent {
  type: "item_completed";
  item: TranscriptItemPayload;
}

export interface TranscriptItemPayload {
  kind: TranscriptItemKind;
  status: TranscriptItemStatus;
  sourceAgentKind: string;
  messageId?: string | null;
  title?: string | null;
  toolCallId?: string | null;
  nativeToolName?: string | null;
  parentToolCallId?: string | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  contentParts?: ContentPart[];
}

export type TranscriptItemKind =
  | "user_message"
  | "assistant_message"
  | "reasoning"
  | "tool_invocation"
  | "plan"
  | "error_item";

export type TranscriptItemStatus = "in_progress" | "completed" | "failed";

export interface TranscriptItemDeltaPayload {
  status?: TranscriptItemStatus | null;
  title?: string | null;
  nativeToolName?: string | null;
  parentToolCallId?: string | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  appendText?: string | null;
  appendReasoning?: string | null;
  replaceContentParts?: ContentPart[] | null;
  appendContentParts?: ContentPart[] | null;
}

export type ContentPart =
  | TextContentPart
  | ReasoningContentPart
  | ToolCallContentPart
  | TerminalOutputContentPart
  | FileReadContentPart
  | FileChangeContentPart
  | PlanContentPart
  | ToolInputTextContentPart
  | ToolResultTextContentPart;

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ReasoningContentPart {
  type: "reasoning";
  text: string;
  visibility: ReasoningVisibility;
}

export type ReasoningVisibility = "private";

export interface ToolCallContentPart {
  type: "tool_call";
  toolCallId: string;
  title: string;
  toolKind?: string | null;
  nativeToolName?: string | null;
}

export interface TerminalOutputContentPart {
  type: "terminal_output";
  terminalId: string;
  event: TerminalLifecycleEvent;
  data?: string | null;
  exitCode?: number | null;
  signal?: string | null;
}

export type TerminalLifecycleEvent = "start" | "output" | "exit";

export interface FileReadContentPart {
  type: "file_read";
  path: string;
  workspacePath?: string | null;
  basename?: string | null;
  line?: number | null;
  scope?: FileReadScope | null;
  startLine?: number | null;
  endLine?: number | null;
  preview?: string | null;
}

export type FileReadScope = "full" | "line" | "range" | "unknown";

export interface FileChangeContentPart {
  type: "file_change";
  operation: FileChangeOperation;
  path: string;
  workspacePath?: string | null;
  basename?: string | null;
  newPath?: string | null;
  newWorkspacePath?: string | null;
  newBasename?: string | null;
  openTarget?: FileOpenTarget | null;
  additions?: number | null;
  deletions?: number | null;
  patch?: string | null;
  preview?: string | null;
  nativeToolName?: string | null;
}

export type FileChangeOperation = "create" | "edit" | "delete" | "move";

export type FileOpenTarget = "file" | "diff";

export interface PlanContentPart {
  type: "plan";
  entries: PlanEntry[];
}

export interface ToolInputTextContentPart {
  type: "tool_input_text";
  text: string;
}

export interface ToolResultTextContentPart {
  type: "tool_result_text";
  text: string;
}

export interface PlanEntry {
  content: string;
  status: string;
}

export interface AvailableCommandsUpdateEvent {
  type: "available_commands_update";
  availableCommands: unknown[];
}

export interface CurrentModeUpdateEvent {
  type: "current_mode_update";
  currentModeId: string;
}

export interface ConfigOptionUpdateEvent {
  type: "config_option_update";
  liveConfig: import("./sessions.js").SessionLiveConfigSnapshot;
}

export interface SessionStateUpdateEvent {
  type: "session_state_update";
  modelId?: string | null;
  requestedModelId?: string | null;
  modeId?: string | null;
  requestedModeId?: string | null;
}

export interface SessionInfoUpdateEvent {
  type: "session_info_update";
  title?: string | null;
  updatedAt?: string | null;
}

export interface UsageUpdateEvent {
  type: "usage_update";
  used: number;
  size: number;
  cost?: unknown;
}

export interface PermissionRequestedEvent {
  type: "permission_requested";
  requestId: string;
  title: string;
  description?: string | null;
  toolCallId?: string | null;
  toolKind?: string | null;
  toolStatus?: string | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  options?: unknown;
}

export interface PermissionResolvedEvent {
  type: "permission_resolved";
  requestId: string;
  outcome: PermissionOutcome;
}

export type PermissionOutcome =
  | { outcome: "selected"; optionId: string }
  | { outcome: "cancelled" };

export interface ErrorEvent {
  type: "error";
  message: string;
  code?: string | null;
}
