import type { HealthResponse } from "../types/runtime.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

export class RuntimeClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async getHealth(options?: AnyHarnessRequestOptions): Promise<HealthResponse> {
    return this.transport.get<HealthResponse>("/health", options);
  }
}
