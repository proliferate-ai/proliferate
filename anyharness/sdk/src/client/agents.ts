import type {
  AgentSummary,
  AgentAuthConfigStatusResponse,
  AgentLaunchOptionsResponse,
  ApplyAgentAuthConfigRequest,
  ApplyAgentAuthConfigResponse,
  InstallAgentRequest,
  InstallAgentResponse,
  ReconcileAgentsRequest,
  ReconcileAgentsResponse,
  AgentLoginTerminalRecord,
  StartAgentLoginResponse,
  StartAgentLoginTerminalResponse,
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

  async applyAuthConfig(
    request: ApplyAgentAuthConfigRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<ApplyAgentAuthConfigResponse> {
    return this.transport.put<ApplyAgentAuthConfigResponse>(
      "/v1/agents/auth-config",
      request,
      options,
    );
  }

  async getAuthConfigStatus(
    options?: AnyHarnessRequestOptions,
  ): Promise<AgentAuthConfigStatusResponse> {
    return this.transport.get<AgentAuthConfigStatusResponse>(
      "/v1/agents/auth-config/status",
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

  async startLoginTerminal(kind: string): Promise<StartAgentLoginTerminalResponse> {
    return this.transport.post<StartAgentLoginTerminalResponse>(
      `/v1/agents/${encodeURIComponent(kind)}/login/terminal`,
      {},
    );
  }

  async getLoginTerminal(
    terminalId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<AgentLoginTerminalRecord> {
    return this.transport.get<AgentLoginTerminalRecord>(
      `/v1/agents/login-terminals/${encodeURIComponent(terminalId)}`,
      options,
    );
  }

  async closeLoginTerminal(terminalId: string): Promise<void> {
    return this.transport.delete(
      `/v1/agents/login-terminals/${encodeURIComponent(terminalId)}`,
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
