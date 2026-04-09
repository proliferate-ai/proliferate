import type {
  AgentSummary,
  InstallAgentRequest,
  InstallAgentResponse,
  ReconcileAgentsRequest,
  ReconcileAgentsResponse,
  StartAgentLoginResponse,
} from "../types/agents.js";
import type { AnyHarnessTransport } from "./core.js";

export class AgentsClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async list(): Promise<AgentSummary[]> {
    return this.transport.get<AgentSummary[]>("/v1/agents");
  }

  async get(kind: string): Promise<AgentSummary> {
    return this.transport.get<AgentSummary>(`/v1/agents/${encodeURIComponent(kind)}`);
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

  async getReconcileStatus(): Promise<ReconcileAgentsResponse> {
    return this.transport.get<ReconcileAgentsResponse>("/v1/agents/reconcile");
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
