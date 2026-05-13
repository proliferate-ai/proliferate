import type {
  AgentSummary,
  AgentLaunchOptionsResponse,
  AgentModelRegistrySnapshotResponse,
  InstallAgentRequest,
  InstallAgentResponse,
  ReconcileAgentsRequest,
  ReconcileAgentsResponse,
  RefreshAgentModelRegistryRequest,
  RefreshAgentModelRegistryResponse,
  StartAgentLoginResponse,
} from "../types/agents.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

export class AgentsClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async list(options?: AnyHarnessRequestOptions): Promise<AgentSummary[]> {
    return this.transport.get<AgentSummary[]>("/v1/agents", options);
  }

  async get(kind: string, options?: AnyHarnessRequestOptions): Promise<AgentSummary> {
    return this.transport.get<AgentSummary>(
      `/v1/agents/${encodeURIComponent(kind)}`,
      options,
    );
  }

  async getLaunchOptions(
    workspaceId?: string | null,
    options?: AnyHarnessRequestOptions,
  ): Promise<AgentLaunchOptionsResponse> {
    return this.transport.get<AgentLaunchOptionsResponse>(
      `/v1/agents/launch-options${workspaceQuery(workspaceId)}`,
      options,
    );
  }

  async getModelRegistry(
    kind: string,
    workspaceId?: string | null,
    options?: AnyHarnessRequestOptions,
  ): Promise<AgentModelRegistrySnapshotResponse> {
    return this.transport.get<AgentModelRegistrySnapshotResponse>(
      `/v1/agents/${encodeURIComponent(kind)}/model-registry${workspaceQuery(workspaceId)}`,
      options,
    );
  }

  async refreshModelRegistry(
    kind: string,
    request: RefreshAgentModelRegistryRequest = {},
  ): Promise<RefreshAgentModelRegistryResponse> {
    return this.transport.post<RefreshAgentModelRegistryResponse>(
      `/v1/agents/${encodeURIComponent(kind)}/model-registry/refresh`,
      request,
    );
  }

  async install(
    kind: string,
    request: InstallAgentRequest = {},
  ): Promise<InstallAgentResponse> {
    return this.transport.post<InstallAgentResponse>(
      `/v1/agents/${encodeURIComponent(kind)}/install`,
      request,
    );
  }

  async startLogin(kind: string): Promise<StartAgentLoginResponse> {
    return this.transport.post<StartAgentLoginResponse>(
      `/v1/agents/${encodeURIComponent(kind)}/login/start`,
      {},
    );
  }

  async getReconcileStatus(options?: AnyHarnessRequestOptions): Promise<ReconcileAgentsResponse> {
    return this.transport.get<ReconcileAgentsResponse>("/v1/agents/reconcile", options);
  }

  async reconcile(
    request: ReconcileAgentsRequest = {},
  ): Promise<ReconcileAgentsResponse> {
    return this.transport.post<ReconcileAgentsResponse>(
      "/v1/agents/reconcile",
      request,
    );
  }
}

function workspaceQuery(workspaceId?: string | null): string {
  const trimmed = workspaceId?.trim() ?? "";
  return trimmed ? `?workspace_id=${encodeURIComponent(trimmed)}` : "";
}
