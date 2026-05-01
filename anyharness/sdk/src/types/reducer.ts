import type {
  ContentPart,
  McpElicitationInteractionPayload,
  PermissionInteractionContext,
  PlanEntry,
  PermissionInteractionOption,
  PromptProvenance,
  ProposedPlanContentPart,
  ProposedPlanDecisionContentPart,
  ErrorEventDetails,
  SessionEventEnvelope,
  SessionLinkTurnCompletedEvent,
  SubagentTurnCompletedEvent,
  StopReason,
  TranscriptItemStatus,
  UserInputQuestion,
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
  pendingInteractions: PendingInteraction[];
  availableCommands: unknown[];
  liveConfig: SessionLiveConfigSnapshot | null;
  currentModeId: string | null;
  usageState: UsageState | null;
  unknownEvents: SessionEventEnvelope[];
  isStreaming: boolean;
  lastSeq: number;
  pendingPrompts: PendingPromptEntry[];
  linkCompletionsByCompletionId: Record<string, LinkCompletionMetadata>;
  latestLinkCompletionBySessionLinkId: Record<string, string>;
}

export interface PendingPromptEntry {
  seq: number;
  promptId: string | null;
  text: string;
  contentParts: ContentPart[];
  queuedAt: string;
  promptProvenance?: PromptProvenance | null;
}

export interface LinkCompletionMetadata {
  relation: string;
  completionId: string;
  sessionLinkId: string;
  parentSessionId: string;
  childSessionId: string;
  childTurnId: string;
  childLastEventSeq: number;
  outcome: SubagentTurnCompletedEvent["outcome"] | SessionLinkTurnCompletedEvent["outcome"];
  label: string | null;
  seq: number;
  timestamp: string;
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
  | ProposedPlanItem
  | ErrorItem
  | UnknownItem;

export interface TranscriptBaseItem {
  itemId: string;
  turnId: string;
  status: TranscriptItemStatus;
  sourceAgentKind: string;
  isTransient?: boolean;
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
  promptProvenance?: PromptProvenance | null;
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

export interface ProposedPlanItem extends TranscriptBaseItem {
  kind: "proposed_plan";
  plan: ProposedPlanContentPart;
  decision: ProposedPlanDecisionContentPart | null;
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
  details: ErrorEventDetails | null;
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

interface PendingInteractionBase {
  requestId: string;
  toolCallId: string | null;
  toolKind: string | null;
  toolStatus: string | null;
  linkedPlanId: string | null;
  title: string;
  description: string | null;
}

export interface PendingPermissionInteraction extends PendingInteractionBase {
  kind: "permission";
  options: PermissionInteractionOption[];
  context?: PermissionInteractionContext | null;
}

export interface PendingUserInputInteraction extends PendingInteractionBase {
  kind: "user_input";
  questions: UserInputQuestion[];
}

export interface PendingMcpElicitationInteraction extends PendingInteractionBase {
  kind: "mcp_elicitation";
  mcpElicitation: McpElicitationInteractionPayload;
}

export type PendingInteraction =
  | PendingPermissionInteraction
  | PendingUserInputInteraction
  | PendingMcpElicitationInteraction;

export type PendingApproval = Extract<PendingInteraction, { kind: "permission" }>;

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
  | "hook"
  | "mode_switch"
  | "cowork_artifact_create"
  | "cowork_artifact_update"
  | "cowork_coding"
  | "other";
