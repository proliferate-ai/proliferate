import type {
  AgentSummary,
  InstallAgentRequest,
  InstallAgentResponse,
  ReconcileAgentsRequest,
  ReconcileAgentsResponse,
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
