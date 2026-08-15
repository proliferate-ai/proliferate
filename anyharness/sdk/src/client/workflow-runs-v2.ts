import type {
  WorkflowRunAddAdhocNodeRequestV2,
  WorkflowRunFailRedoRequestV2,
  WorkflowRunFlipTypeRequestV2,
  WorkflowRunProjectionV2,
  WorkflowRunPutRequestV2,
  WorkflowRunV2,
} from "../types/workflow-runs-v2.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

/**
 * Wire + return shape for `GET /v1/workflow-runs`, confirmed by PR5a's
 * regenerated schema (`WorkflowRunsListResponse` in generated/openapi.ts).
 */
export interface WorkflowRunsListResponseV2 {
  runs: WorkflowRunV2[];
}

export class WorkflowRunsV2Client {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async putRun(
    runId: string,
    body: WorkflowRunPutRequestV2,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkflowRunProjectionV2> {
    return this.transport.put<WorkflowRunProjectionV2>(
      `/v1/workflow-runs/${encodeURIComponent(runId)}`,
      body,
      options,
    );
  }

  async getRun(
    runId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkflowRunProjectionV2> {
    return this.transport.get<WorkflowRunProjectionV2>(
      `/v1/workflow-runs/${encodeURIComponent(runId)}`,
      options,
    );
  }

  async listRuns(
    workspaceId?: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkflowRunsListResponseV2> {
    const params = new URLSearchParams();
    if (workspaceId) {
      params.set("workspace_id", workspaceId);
    }
    const query = params.size > 0 ? `?${params.toString()}` : "";
    return this.transport.get<WorkflowRunsListResponseV2>(
      `/v1/workflow-runs${query}`,
      options,
    );
  }

  async approve(
    runId: string,
    nodeRowId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkflowRunProjectionV2> {
    return this.transport.post<WorkflowRunProjectionV2>(
      `/v1/workflow-runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeRowId)}/approve`,
      {},
      options,
    );
  }

  async failRedo(
    runId: string,
    nodeRowId: string,
    body: WorkflowRunFailRedoRequestV2,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkflowRunProjectionV2> {
    return this.transport.post<WorkflowRunProjectionV2>(
      `/v1/workflow-runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeRowId)}/fail-redo`,
      body,
      options,
    );
  }

  async flipType(
    runId: string,
    nodeRowId: string,
    body: WorkflowRunFlipTypeRequestV2,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkflowRunProjectionV2> {
    return this.transport.post<WorkflowRunProjectionV2>(
      `/v1/workflow-runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeRowId)}/type`,
      body,
      options,
    );
  }

  async undoAdvance(
    runId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkflowRunProjectionV2> {
    return this.transport.post<WorkflowRunProjectionV2>(
      `/v1/workflow-runs/${encodeURIComponent(runId)}/undo-advance`,
      {},
      options,
    );
  }

  async resume(
    runId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkflowRunProjectionV2> {
    return this.transport.post<WorkflowRunProjectionV2>(
      `/v1/workflow-runs/${encodeURIComponent(runId)}/resume`,
      {},
      options,
    );
  }

  async addAdhocNode(
    runId: string,
    body: WorkflowRunAddAdhocNodeRequestV2,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkflowRunProjectionV2> {
    return this.transport.post<WorkflowRunProjectionV2>(
      `/v1/workflow-runs/${encodeURIComponent(runId)}/adhoc-nodes`,
      body,
      options,
    );
  }

  async cancel(
    runId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkflowRunProjectionV2> {
    return this.transport.post<WorkflowRunProjectionV2>(
      `/v1/workflow-runs/${encodeURIComponent(runId)}/cancel`,
      {},
      options,
    );
  }
}
