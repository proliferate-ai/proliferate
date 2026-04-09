import type { HealthResponse } from "../types/runtime.js";
import type { AnyHarnessTransport } from "./core.js";

export class RuntimeClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async getHealth(): Promise<HealthResponse> {
    return this.transport.get<HealthResponse>("/health");
  }
}
