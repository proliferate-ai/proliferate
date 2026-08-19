import type {
  AgentSummary,
  HarnessLaunchOptionsResponse,
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

  async getLaunchOptions(
    harnessKind: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<HarnessLaunchOptionsResponse> {
    return this.transport.get<HarnessLaunchOptionsResponse>(
      `/v1/agents/${encodeURIComponent(harnessKind)}/launch-options`,
      options,
    );
  }

  async refreshLaunchOptions(harnessKind: string): Promise<HarnessLaunchOptionsResponse> {
    return this.transport.post<HarnessLaunchOptionsResponse>(
      `/v1/agents/${encodeURIComponent(harnessKind)}/launch-options/refresh`,
      {},
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
