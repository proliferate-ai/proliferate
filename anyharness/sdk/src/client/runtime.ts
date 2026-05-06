import type { HealthResponse } from "../types/runtime.js";
import type { WorkspaceSessionLaunchCatalog } from "../types/workspaces.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";
import { withTimingCategory } from "./core.js";

export class RuntimeClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async getHealth(options?: AnyHarnessRequestOptions): Promise<HealthResponse> {
    return this.transport.get<HealthResponse>("/health", options);
  }

  async getEffectiveAgentLaunchCatalog(
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkspaceSessionLaunchCatalog> {
    return this.transport.get<WorkspaceSessionLaunchCatalog>(
      "/v1/catalogs/agents/effective",
      withTimingCategory(options, "catalog.agents.effective"),
    );
  }
}
