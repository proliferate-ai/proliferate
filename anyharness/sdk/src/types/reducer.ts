import type {
  ContentPart,
  PlanEntry,
  SessionEventEnvelope,
  StopReason,
  TranscriptItemStatus,
} from "./events.js";
import type { SessionLiveConfigSnapshot } from "./sessions.js";

export interface TranscriptState {
  sessionMeta: {
    sessionId: string;
    title: string | null;
    updatedAt: string | null;
    nativeSessionId: string | null;
    sourceAgentKind: string | null;
  };
  turnOrder: string[];
  turnsById: Record<string, TurnRecord>;
  itemsById: Record<string, TranscriptItem>;
  openAssistantItemId: string | null;
  openThoughtItemId: string | null;
  pendingApproval: PendingApproval | null;
  availableCommands: unknown[];
  liveConfig: SessionLiveConfigSnapshot | null;
  currentModeId: string | null;
  usageState: UsageState | null;
  unknownEvents: SessionEventEnvelope[];
  isStreaming: boolean;
  lastSeq: number;
  pendingPrompts: PendingPromptEntry[];
}

export interface PendingPromptEntry {
  seq: number;
  promptId: string | null;
  text: string;
  queuedAt: string;
}

export interface TurnRecord {
  turnId: string;
  itemOrder: string[];
  startedAt: string;
  completedAt: string | null;
  stopReason: StopReason | string | null;
  fileBadges: FileBadge[];
}

export interface FileBadge {
  path: string;
  additions: number;
  deletions: number;
}

export type TranscriptItem =
  | UserMessageItem
  | AssistantProseItem
  | ThoughtItem
  | ToolCallItem
  | PlanItem
  | ErrorItem
  | UnknownItem;

export interface TranscriptBaseItem {
  itemId: string;
  turnId: string;
  status: TranscriptItemStatus;
  sourceAgentKind: string;
  messageId: string | null;
  title: string | null;
  nativeToolName: string | null;
  parentToolCallId: string | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  contentParts: ContentPart[];
  timestamp: string;
  startedSeq: number;
  lastUpdatedSeq: number;
  completedSeq: number | null;
  completedAt: string | null;
}

export interface UserMessageItem extends TranscriptBaseItem {
  kind: "user_message";
  text: string;
  isStreaming: boolean;
}

export interface AssistantProseItem extends TranscriptBaseItem {
  kind: "assistant_prose";
  text: string;
  isStreaming: boolean;
}

export interface ThoughtItem extends TranscriptBaseItem {
  kind: "thought";
  text: string;
  isStreaming: boolean;
}

export interface ToolCallItem extends TranscriptBaseItem {
  kind: "tool_call";
  toolCallId: string | null;
  toolKind: string;
  semanticKind: ToolCallSemanticKind;
  approvalState: "none" | "pending" | "approved" | "rejected";
}

export interface PlanItem extends TranscriptBaseItem {
  kind: "plan";
  entries: PlanEntry[];
}

export type CanonicalPlanSourceKind = "structured_plan" | "mode_switch";

export interface CanonicalPlan {
  title: string;
  sourceKind: CanonicalPlanSourceKind;
  itemId: string;
  turnId: string;
  entries: PlanEntry[];
  body: string | null;
  isActive: boolean;
}

export interface ErrorItem extends TranscriptBaseItem {
  kind: "error";
  message: string;
  code: string | null;
}

export interface UnknownItem {
  kind: "unknown";
  itemId: string;
  turnId: string | null;
  eventType: string;
  rawPayload: unknown;
  timestamp: string;
  startedSeq: number;
}

export interface PendingApproval {
  requestId: string;
  toolCallId: string | null;
  toolKind: string | null;
  title: string;
  options: unknown;
}

export interface UsageState {
  used: number;
  size: number;
  cost: unknown;
}

export type ToolCallSemanticKind =
  | "subagent"
  | "file_read"
  | "file_change"
  | "terminal"
  | "search"
  | "fetch"
  | "mode_switch"
  | "other";
