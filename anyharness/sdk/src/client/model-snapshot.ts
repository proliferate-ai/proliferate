import type { ModelSnapshotStatus } from "../types/model-snapshot.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

export class ModelSnapshotClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  /** Per-auth-context probe status for one agent kind (never polls-pushed — poll this). */
  async getStatus(
    kind: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<ModelSnapshotStatus> {
    return this.transport.get<ModelSnapshotStatus>(
      `/v1/agents/${encodeURIComponent(kind)}/model-snapshot`,
      options,
    );
  }

  /** Force one context's re-probe now (the desktop Refresh button, owner runtimes only). */
  async refresh(
    kind: string,
    authContextId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<ModelSnapshotStatus> {
    return this.transport.post<ModelSnapshotStatus>(
      `/v1/agents/${encodeURIComponent(kind)}/model-snapshot/refresh?authContextId=${encodeURIComponent(authContextId)}`,
      {},
      options,
    );
  }
}
