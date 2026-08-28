import type {
  AgentSummary,
  HarnessLaunchOptionsResponse,
  InstallAgentRequest,
  InstallAgentResponse,
  ReconcileAgentsRequest,
  ReconcileAgentsResponse,
  AgentLoginTerminalRecord,
  AgentLoginVariant,
  ClaimAgentMintTokenResponse,
  StartAgentLoginResponse,
  StartAgentLoginTerminalResponse,
} from "../types/agents.js";
import type {
  NativeIntegrationsResponse,
} from "../types/native-integrations.js";
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

  async startLoginTerminal(
    kind: string,
    variant?: AgentLoginVariant,
  ): Promise<StartAgentLoginTerminalResponse> {
    return this.transport.post<StartAgentLoginTerminalResponse>(
      `/v1/agents/${encodeURIComponent(kind)}/login/terminal`,
      variant ? { variant } : {},
    );
  }

  /**
   * The one-time seat-token handoff (seats v1): returns the captured mint
   * token exactly once — the runtime wipes its buffer as it serves this.
   * Callers hold the token in memory only and POST it straight to the vault.
   */
  async claimMintToken(terminalId: string): Promise<ClaimAgentMintTokenResponse> {
    return this.transport.post<ClaimAgentMintTokenResponse>(
      `/v1/agents/login-terminals/${encodeURIComponent(terminalId)}/mint-token`,
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

  /**
   * One harness's discovered native integrations (its own MCP servers plus
   * the curated vendor bundles), merged with the user's selections.
   * Discovery is re-read from disk on every call — nothing here is cached
   * runtime-side.
   */
  async listNativeIntegrations(
    kind: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<NativeIntegrationsResponse> {
    return this.transport.get<NativeIntegrationsResponse>(
      `/v1/agents/${encodeURIComponent(kind)}/native-integrations`,
      options,
    );
  }

  /** Flip one native-integration selection; answers with the refreshed listing. */
  async setNativeIntegrationSelection(
    kind: string,
    integrationId: string,
    enabled: boolean,
  ): Promise<NativeIntegrationsResponse> {
    return this.transport.put<NativeIntegrationsResponse>(
      `/v1/agents/${encodeURIComponent(kind)}/native-integrations/${encodeURIComponent(integrationId)}`,
      { enabled },
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
