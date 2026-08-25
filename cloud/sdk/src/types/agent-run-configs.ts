type AgentRunConfigOwnerScope = "personal" | "organization";

export interface CloudAgentRunConfig {
  id: string;
  name: string;
  ownerScope: AgentRunConfigOwnerScope | "system";
  ownerUserId?: string | null;
  organizationId?: string | null;
  createdByUserId?: string | null;
  agentKind: string;
  modelId: string;
  controlValues: Record<string, string>;
  usableInPersonalSandboxes: boolean;
  usableInSharedSandboxes: boolean;
  seedKey?: string | null;
  systemDefaultRank?: number | null;
  status: "active" | "archived";
  resolved?: {
    configId: string;
    configName: string;
    agentKind: string;
    modelId: string;
    controlValues: Record<string, string>;
    ignoredKeys: string[];
  } | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface CloudAgentRunConfigListResponse {
  configs: CloudAgentRunConfig[];
}

export interface CloudAgentRunConfigDefault {
  id: string;
  ownerScope: AgentRunConfigOwnerScope;
  ownerUserId?: string | null;
  organizationId?: string | null;
  agentKind: string;
  configId: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CloudAgentRunConfigDefaultsResponse {
  defaults: CloudAgentRunConfigDefault[];
}

export interface CloudAgentRunConfigOwnerSelection {
  ownerScope?: AgentRunConfigOwnerScope | "system";
  organizationId?: string | null;
}

export interface CloudAgentRunConfigDefaultOwnerSelection {
  ownerScope?: AgentRunConfigOwnerScope;
  organizationId?: string | null;
}

export interface ListCloudAgentRunConfigsOptions
  extends CloudAgentRunConfigOwnerSelection {
  agentKind?: string | null;
  usableIn?: "personal_sandboxes" | "shared_sandboxes" | null;
  status?: "active" | "archived" | null;
}

export interface CreateCloudAgentRunConfigRequest {
  name: string;
  ownerScope: AgentRunConfigOwnerScope;
  organizationId?: string | null;
  agentKind: string;
  modelId: string;
  controlValues?: Record<string, string>;
  usableInPersonalSandboxes?: boolean;
  usableInSharedSandboxes?: boolean;
}

export interface UpdateCloudAgentRunConfigRequest {
  name?: string | null;
  modelId?: string | null;
  controlValues?: Record<string, string> | null;
  usableInPersonalSandboxes?: boolean | null;
  usableInSharedSandboxes?: boolean | null;
}

export interface SetCloudAgentRunConfigDefaultRequest {
  configId: string;
}
