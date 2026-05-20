export type CloudCommandKind =
  | "start_session"
  | "configure_git_identity"
  | "ensure_repo_checkout"
  | "materialize_workspace"
  | "materialize_environment"
  | "resume_session"
  | "send_prompt"
  | "resolve_interaction"
  | "update_session_config"
  | "cancel_turn"
  | "close_session"
  | "cancel_session"
  | "stop_workspace"
  | "hibernate_workspace"
  | "resume_workspace"
  | "prune_workspace"
  | "extend_workspace_ttl"
  | "sync_existing_workspace";

export type CloudCommandStatus =
  | "queued"
  | "leased"
  | "delivered"
  | "accepted"
  | "accepted_but_queued"
  | "rejected"
  | "expired"
  | "superseded"
  | "failed_delivery";

export interface CloudCommandEnvelope<TPayload = unknown> {
  idempotencyKey: string;
  targetId: string;
  workspaceId?: string | null;
  cloudWorkspaceId?: string | null;
  sessionId?: string | null;
  kind: CloudCommandKind;
  payload: TPayload;
  observedEventSeq?: number | null;
  preconditions?: Record<string, unknown> | null;
  expiresAt?: string | null;
  source?: "web" | "mobile" | "slack" | "api" | "automation" | "desktop_cloud_view" | null;
}

export interface CloudCommandResponse {
  commandId: string;
  idempotencyKey?: string;
  status: CloudCommandStatus;
  targetId: string;
  workspaceId?: string | null;
  cloudWorkspaceId?: string | null;
  sessionId?: string | null;
  kind?: CloudCommandKind | string;
  source?: string;
  leaseId?: string | null;
  leaseExpiresAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  deliveredAt?: string | null;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  result?: Record<string, unknown> | null;
}
