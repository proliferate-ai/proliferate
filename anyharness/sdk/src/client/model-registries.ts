import type { ModelRegistry } from "../types/model-registries.js";
import type { AnyHarnessTransport } from "./core.js";

export class ModelRegistriesClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async list(): Promise<ModelRegistry[]> {
    return this.transport.get<ModelRegistry[]>("/v1/model-registries");
  }

  async get(kind: string): Promise<ModelRegistry> {
    return this.transport.get<ModelRegistry>(
      `/v1/model-registries/${encodeURIComponent(kind)}`,
    );
  }
}
