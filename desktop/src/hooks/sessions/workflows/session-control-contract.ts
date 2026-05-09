import type {
  ContentPart,
  PromptInputBlock,
} from "@anyharness/sdk";
import type { SessionActivationGuard, SessionActivationOutcome } from "@/hooks/sessions/session-activation-guard";
import type { PromptAttachmentSnapshot } from "@/lib/domain/chat/composer/prompt-attachment-snapshot";
import type { MeasurementOperationId } from "@/lib/infra/measurement/debug-measurement";

export interface SessionLatencyFlowOptions {
  latencyFlowId?: string | null;
}

export interface PromptLatencyFlowOptions extends SessionLatencyFlowOptions {
  measurementOperationId?: MeasurementOperationId | null;
  promptId?: string | null;
}

export interface ActiveSessionPromptOptions extends PromptLatencyFlowOptions {
  blocks?: PromptInputBlock[];
  attachmentSnapshots?: PromptAttachmentSnapshot[];
  optimisticContentParts?: ContentPart[];
}

export interface LaunchPromptInput extends SessionLatencyFlowOptions {
  workspaceId: string;
  agentKind: string;
  modelId: string;
  text: string;
  blocks?: PromptInputBlock[];
  attachmentSnapshots?: PromptAttachmentSnapshot[];
  optimisticContentParts?: ContentPart[];
  promptId?: string | null;
  onBeforeOptimisticPrompt?: (workspaceId: string) => Promise<void> | void;
}

export interface SessionConfigOptionUpdateOptions {
  persistDefaultPreference?: boolean;
}

export interface CreateSessionWithResolvedConfigInput {
  text: string;
  blocks?: PromptInputBlock[];
  attachmentSnapshots?: PromptAttachmentSnapshot[];
  optimisticContentParts?: ContentPart[];
  agentKind: string;
  modelId: string;
  modeId?: string;
  workspaceId?: string;
  latencyFlowId?: string | null;
  measurementOperationId?: MeasurementOperationId | null;
  promptId?: string | null;
  preferExistingCompatibleSession?: boolean;
  onBeforeOptimisticPrompt?: (workspaceId: string) => Promise<void> | void;
}

export interface WorkspaceSessionSummaryForControl {
  id: string;
  agentKind: string;
  modelId?: string | null;
  workspaceId: string;
  lastPromptAt?: string | null;
}

export interface SessionControlDeps {
  createSessionWithResolvedConfig: (
    options: CreateSessionWithResolvedConfigInput
  ) => Promise<string>;
  ensureWorkspaceSessions: (
    workspaceId: string
  ) => Promise<WorkspaceSessionSummaryForControl[]>;
  selectSession: (
    sessionId: string,
    options?: SessionLatencyFlowOptions & { guard?: SessionActivationGuard }
  ) => Promise<SessionActivationOutcome | void>;
  activateSession: (sessionId: string | null) => void;
}
