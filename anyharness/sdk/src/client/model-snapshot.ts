import type { ModelSnapshotStatus } from "../types/model-snapshot.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

export class ModelSnapshotClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  /** The composed probe status for one agent kind (never pushed — poll this). */
  async getStatus(
    kind: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<ModelSnapshotStatus> {
    return this.transport.get<ModelSnapshotStatus>(
      `/v1/agents/${encodeURIComponent(kind)}/model-snapshot`,
      options,
    );
  }

  /**
   * Force a re-probe of the harness now (the manual-refresh poke, owner
   * runtimes only). No `authContextId`: one composed observation per harness.
   */
  async refresh(
    kind: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<ModelSnapshotStatus> {
    return this.transport.post<ModelSnapshotStatus>(
      `/v1/agents/${encodeURIComponent(kind)}/model-snapshot/refresh`,
      {},
      options,
    );
  }
}
