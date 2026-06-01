import type {
  CloudCommandEnvelope,
  CloudCommandResponse,
} from "@proliferate/cloud-sdk";

export type SendPromptPayload = {
  text: string;
  promptId?: string;
};

export type StartSessionPayload = {
  workspaceId: string;
  agentKind: string;
  modelId?: string | null;
  modeId?: string | null;
  subagentsEnabled: boolean;
  origin: {
    kind: "system";
    entrypoint: "cloud";
  };
};

export type UpdateSessionConfigPayload = {
  configId: string;
  value: string;
};

export type EnqueueCloudCommand<TPayload> = (
  command: CloudCommandEnvelope<TPayload>,
) => Promise<CloudCommandResponse>;

export type PendingMobilePromptDispatchResult = {
  sessionId: string;
  sendCommandId: string;
};
