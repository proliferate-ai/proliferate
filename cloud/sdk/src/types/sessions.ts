import type { CloudWorkspaceDetail } from "./generated.js";

export interface CloudSessionConfigState {
  version: number;
  current: Record<string, unknown>;
  available: Record<string, unknown>;
  updatedAt?: string | null;
}

export interface CloudSessionProjection {
  sessionId: string;
  workspaceId: string;
  targetId: string;
  title?: string | null;
  status?: string | null;
  phase?: string | null;
  startedAt?: string | null;
  lastEventAt?: string | null;
  lastEventSeq: number;
  pendingInteractionCount: number;
  parentSessionId?: string | null;
  config?: CloudSessionConfigState | null;
  [key: string]: any;
}

export interface CloudTranscriptItem {
  itemId: string;
  sessionId?: string | null;
  turnId?: string | null;
  role?: string | null;
  kind?: string | null;
  createdAt?: string | null;
  [key: string]: any;
}

export interface CloudPendingInteraction {
  requestId: string;
  sessionId?: string | null;
  status?: string | null;
  kind?: string | null;
  commandId?: string | null;
  prompt?: string | null;
  createdAt?: string | null;
  [key: string]: any;
}

export interface CloudSessionEventEnvelope {
  turnId?: string | null;
  itemId?: string | null;
  timestamp?: string | null;
  [key: string]: any;
}

export interface CloudSessionSnapshot {
  session: CloudSessionProjection;
  transcriptItems: CloudTranscriptItem[];
  pendingInteractions: CloudPendingInteraction[];
  [key: string]: any;
}

export interface CloudWorkspaceSnapshot {
  workspace: CloudWorkspaceDetail;
  sessions: CloudSessionProjection[];
  [key: string]: any;
}

export interface CloudTranscriptSnapshot {
  transcriptItems: CloudTranscriptItem[];
  pendingInteractions?: CloudPendingInteraction[];
  [key: string]: any;
}
