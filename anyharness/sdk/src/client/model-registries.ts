import type { ModelRegistry } from "../types/model-registries.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

export class ModelRegistriesClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async list(options?: AnyHarnessRequestOptions): Promise<ModelRegistry[]> {
    return this.transport.get<ModelRegistry[]>("/v1/model-registries", options);
  }

  async get(kind: string, options?: AnyHarnessRequestOptions): Promise<ModelRegistry> {
    return this.transport.get<ModelRegistry>(
      `/v1/model-registries/${encodeURIComponent(kind)}`,
      options,
    );
  }
}
