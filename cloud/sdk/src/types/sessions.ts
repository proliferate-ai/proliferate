export type CloudSessionStatus =
  | "pending"
  | "starting"
  | "running"
  | "idle"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "cancelled";

export interface CloudSessionConfigState {
  version: number;
  current: Record<string, unknown>;
  available: Record<string, unknown>;
  updatedAt?: string | null;
}

export interface CloudRequest {
  id: string;
  sessionId: string;
  type: "permission" | "user_input" | "credential" | "configuration";
  status: "pending" | "resolved" | "expired" | "cancelled";
  version: number;
  title?: string | null;
  body?: string | null;
  options?: Record<string, unknown> | null;
  createdAt?: string | null;
  resolvedAt?: string | null;
}

export interface CloudMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  status: "pending" | "streaming" | "completed" | "failed";
  text: string;
  createdAt?: string | null;
  completedAt?: string | null;
}

export interface CloudToolCallSummary {
  id: string;
  sessionId: string;
  name: string;
  status: "started" | "completed" | "failed";
  summary?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface CloudWorkspaceSnapshot {
  workspaceId: string;
  targetId: string;
  displayName?: string | null;
  repo?: Record<string, unknown> | null;
  status: string;
  sessions: CloudSessionSnapshot[];
  lastActivityAt?: string | null;
}

export interface CloudSessionSnapshot {
  sessionId: string;
  workspaceId: string;
  targetId: string;
  status: CloudSessionStatus;
  agent?: string | null;
  model?: string | null;
  config?: CloudSessionConfigState | null;
  pendingRequests: CloudRequest[];
  lastEventSeq?: number | null;
  lastActivityAt?: string | null;
}

export interface CloudTranscriptSnapshot {
  sessionId: string;
  messages: CloudMessage[];
  toolCalls: CloudToolCallSummary[];
  pendingRequests: CloudRequest[];
  lastEventSeq?: number | null;
}

