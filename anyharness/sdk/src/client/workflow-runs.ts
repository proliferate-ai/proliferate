import type {
  VersionedPutWorkflowRunRequest,
  VersionedWorkflowRunResponse,
} from "../types/workflow-runs.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

/**
 * Typed local AnyHarness Workflow-run resource.
 *
 * Wraps the already-generated `/v1/workflow-runs/{runId}` contract that the
 * runtime exposes (PUT create/replay, GET durable status, POST cancel). The
 * versioned request/response unions carry both the schema-v1 (`managedCloud`)
 * and schema-v2 (portable / connected-Desktop) families, so this single
 * resource serves both delivery targets without a fork.
 *
 * Behavior preserved from the generated contract:
 * - PUT returns `201` for a new durable acceptance and `200` for an exact
 *   replay of an identical invocation; both carry the same versioned response
 *   body, so callers reconcile idempotently on the body, not the status line.
 *   (The shared transport does not surface success status codes; a caller that
 *   must branch created-vs-replayed observes the same durable run either way.)
 * - `409` (same ID, different invocation, or workspace-binding conflict),
 *   `404`, `400`, `403`, `422`, and RFC 7807 Problem Details all surface as
 *   `AnyHarnessError` from the transport.
 *
 * The `runId` is the canonical UUID: for a connected-Desktop invocation it is
 * the Cloud invocation UUID reused byte-for-byte as the local run ID.
 */
export class WorkflowRunsClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  /**
   * PUT a workflow run by its canonical UUID.
   *
   * Idempotent: the same `runId` with an identical request replays the exact
   * durable run (`200`); a new request creates it (`201`). Both return the same
   * versioned response body.
   */
  async put(
    runId: string,
    request: VersionedPutWorkflowRunRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<VersionedWorkflowRunResponse> {
    return this.transport.put<VersionedWorkflowRunResponse>(
      `/v1/workflow-runs/${encodeURIComponent(runId)}`,
      request,
      options,
    );
  }

  /** GET the durable run and step status for a canonical run UUID. */
  async get(
    runId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<VersionedWorkflowRunResponse> {
    return this.transport.get<VersionedWorkflowRunResponse>(
      `/v1/workflow-runs/${encodeURIComponent(runId)}`,
      options,
    );
  }

  /**
   * POST durable cancellation intent for a run. Returns the current truthful
   * versioned snapshot. This is Workflow-run cancel, not direct session cancel.
   */
  async cancel(
    runId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<VersionedWorkflowRunResponse> {
    return this.transport.post<VersionedWorkflowRunResponse>(
      `/v1/workflow-runs/${encodeURIComponent(runId)}/cancel`,
      {},
      options,
    );
  }
}
