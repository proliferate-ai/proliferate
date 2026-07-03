import type {
  GatewayModelsResponse,
  RefreshGatewayModelsResponse,
} from "../types/agent-gateway-catalog.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

export class AgentGatewayCatalogClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  /** The runtime's resolved gateway model plan (probe row or catalog seed). */
  async getGatewayModels(
    kind: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<GatewayModelsResponse> {
    return this.transport.get<GatewayModelsResponse>(
      `/v1/agents/${encodeURIComponent(kind)}/catalog/gateway-models`,
      options,
    );
  }

  /** Re-probe the gateway now and record the result (the desktop Refresh button). */
  async refreshGatewayModels(
    kind: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<RefreshGatewayModelsResponse> {
    return this.transport.post<RefreshGatewayModelsResponse>(
      `/v1/agents/${encodeURIComponent(kind)}/catalog/refresh-gateway`,
      {},
      options,
    );
  }
}
