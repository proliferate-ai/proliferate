import type { ProviderConfig } from "../types/providers.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

export class ProvidersClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async listConfigs(options?: AnyHarnessRequestOptions): Promise<ProviderConfig[]> {
    return this.transport.get<ProviderConfig[]>("/v1/provider-configs", options);
  }
}
