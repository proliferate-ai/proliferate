import type { AutomationOwnerScope } from "./generated.js";

export interface CloudAgentRunConfig {
  id: string;
  name: string;
  ownerScope: AutomationOwnerScope | "system";
  ownerUserId?: string | null;
  organizationId?: string | null;
  createdByUserId?: string | null;
  agentKind: string;
  modelId: string;
  controlValues: Record<string, unknown>;
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
    controlValues: Record<string, unknown>;
    ignoredKeys: string[];
  } | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface CloudAgentRunConfigListResponse {
  configs: CloudAgentRunConfig[];
}

export interface CloudAgentRunConfigOwnerSelection {
  ownerScope?: AutomationOwnerScope | "system";
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
  ownerScope: AutomationOwnerScope;
  organizationId?: string | null;
  agentKind: string;
  modelId: string;
  controlValues?: Record<string, unknown>;
  usableInPersonalSandboxes?: boolean;
  usableInSharedSandboxes?: boolean;
}

export interface UpdateCloudAgentRunConfigRequest {
  name?: string | null;
  modelId?: string | null;
  controlValues?: Record<string, unknown> | null;
  usableInPersonalSandboxes?: boolean | null;
  usableInSharedSandboxes?: boolean | null;
}
