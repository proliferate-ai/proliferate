/**
 * Session contract types.
 */

export type SessionStatus =
  | "starting"
  | "idle"
  | "running"
  | "completed"
  | "errored"
  | "closed";

export type SessionExecutionPhase =
  | "starting"
  | "running"
  | "awaiting_permission"
  | "idle"
  | "errored"
  | "closed";

export interface PendingApprovalSummary {
  requestId: string;
  title: string;
  toolCallId?: string | null;
  toolKind?: string | null;
}

export interface SessionExecutionSummary {
  phase: SessionExecutionPhase;
  hasLiveHandle: boolean;
  pendingApproval?: PendingApprovalSummary | null;
  updatedAt: string;
}

export interface Session {
  id: string;
  workspaceId: string;
  agentKind: string;
  nativeSessionId?: string | null;
  modelId?: string | null;
  requestedModelId?: string | null;
  modeId?: string | null;
  requestedModeId?: string | null;
  title?: string | null;
  liveConfig?: SessionLiveConfigSnapshot | null;
  executionSummary?: SessionExecutionSummary | null;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  lastPromptAt?: string | null;
  closedAt?: string | null;
  dismissedAt?: string | null;
}

export interface CreateSessionRequest {
  workspaceId: string;
  agentKind: string;
  modelId?: string;
  modeId?: string;
  systemPromptAppend?: string[];
}

export interface UpdateSessionTitleRequest {
  title: string;
}

export interface RawSessionConfigValue {
  value: string;
  name: string;
  description?: string | null;
}

export type SessionConfigOptionType = "select";

export interface RawSessionConfigOption {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  type: SessionConfigOptionType;
  currentValue: string;
  options: RawSessionConfigValue[];
}

export interface NormalizedSessionControlValue {
  value: string;
  label: string;
  description?: string | null;
}

export interface NormalizedSessionControl {
  key: string;
  rawConfigId: string;
  label: string;
  currentValue?: string | null;
  settable: boolean;
  values: NormalizedSessionControlValue[];
}

export interface NormalizedSessionControls {
  model?: NormalizedSessionControl | null;
  collaborationMode?: NormalizedSessionControl | null;
  mode?: NormalizedSessionControl | null;
  reasoning?: NormalizedSessionControl | null;
  effort?: NormalizedSessionControl | null;
  fastMode?: NormalizedSessionControl | null;
  extras: NormalizedSessionControl[];
}

export interface SessionLiveConfigSnapshot {
  rawConfigOptions: RawSessionConfigOption[];
  normalizedControls: NormalizedSessionControls;
  sourceSeq: number;
  updatedAt: string;
}

export interface GetSessionLiveConfigResponse {
  liveConfig?: SessionLiveConfigSnapshot | null;
}

export interface SetSessionConfigOptionRequest {
  configId: string;
  value: string;
}

export type ConfigApplyState = "applied" | "queued";

export interface SetSessionConfigOptionResponse {
  session: Session;
  liveConfig?: SessionLiveConfigSnapshot | null;
  applyState: ConfigApplyState;
}

export interface PromptInputBlock {
  type: "text";
  text: string;
}

export interface PromptSessionRequest {
  blocks: PromptInputBlock[];
}

export interface PromptSessionResponse {
  session: Session;
}

export type PermissionDecision = "allow" | "deny";

export interface ListSessionEventsOptions {
  afterSeq?: number;
}

export interface ResolvePermissionRequest {
  decision?: PermissionDecision;
  optionId?: string;
}
