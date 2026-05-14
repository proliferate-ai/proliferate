export type CloudCommandKind =
  | "start_session"
  | "send_prompt"
  | "resolve_interaction"
  | "cancel_session"
  | "cancel_turn"
  | "update_session_config";

export type CloudCommandStatus =
  | "queued"
  | "leased"
  | "delivered"
  | "accepted"
  | "rejected"
  | "expired"
  | "failed";

export interface CloudCommandEnvelope<TPayload = unknown> {
  idempotencyKey: string;
  targetId: string;
  workspaceId?: string | null;
  sessionId?: string | null;
  kind: CloudCommandKind;
  payload: TPayload;
  observedEventSeq?: number | null;
  expiresAt?: string | null;
}

export interface CloudCommandResponse {
  commandId: string;
  status: CloudCommandStatus;
  targetId: string;
  workspaceId?: string | null;
  sessionId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

