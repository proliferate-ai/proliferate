import type { ProviderConfig } from "../types/providers.js";
import type { AnyHarnessTransport } from "./core.js";

export class ProvidersClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async listConfigs(): Promise<ProviderConfig[]> {
    return this.transport.get<ProviderConfig[]>("/v1/provider-configs");
  }
}
