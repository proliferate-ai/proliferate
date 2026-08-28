import type { components } from "../generated/openapi.js";
import type {
  AgentAuthStateDocument,
  ApplyAgentAuthStateResponse,
  NativeBridgeResponse,
} from "../types/agent-auth.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

/** One harness's status document (agent_auth spec §2) — served verbatim. */
export type AgentAuthStatusDoc = components["schemas"]["AgentAuthStatusDoc"];
/** One method row of a status document. */
export type AgentAuthMethodRow = components["schemas"]["AgentAuthMethodRow"];

export class AgentAuthClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async applyState(
    input: AgentAuthStateDocument,
    options?: AnyHarnessRequestOptions,
  ): Promise<ApplyAgentAuthStateResponse> {
    return this.transport.put<ApplyAgentAuthStateResponse>(
      "/v1/agent-auth/state",
      input,
      options,
    );
  }

  async clearState(options?: AnyHarnessRequestOptions): Promise<void> {
    await this.transport.delete("/v1/agent-auth/state", options);
  }

  /**
   * The persisted per-harness status documents. Pass `harness` to filter to
   * one (404 for an unknown harness). Live updates ride the SSE stream at
   * `GET /v1/agent-auth/status/stream` (one snapshot event per current
   * document on connect, then one event per change); polling this GET is the
   * documented fallback where SSE is unavailable.
   */
  async status(
    harness?: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<AgentAuthStatusDoc[]> {
    const path = harness
      ? `/v1/agent-auth/status?harness=${encodeURIComponent(harness)}`
      : "/v1/agent-auth/status";
    return this.transport.get<AgentAuthStatusDoc[]>(path, options);
  }

  /** The harness's method rows, straight from its status document. */
  async methods(
    harness: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<AgentAuthMethodRow[]> {
    return this.transport.get<AgentAuthMethodRow[]>(
      `/v1/agent-auth/methods?harness=${encodeURIComponent(harness)}`,
      options,
    );
  }

  /** The native-migration bridge: harnesses still on the legacy flag. */
  async getNativeBridge(
    options?: AnyHarnessRequestOptions,
  ): Promise<NativeBridgeResponse> {
    return this.transport.get<NativeBridgeResponse>(
      "/v1/agent-auth/native-bridge",
      options,
    );
  }

  /**
   * The one-time prompt's dismiss-to-configure act: drop one harness's
   * legacy flag so its next launch follows the real convention.
   */
  async dismissNativeBridge(
    harnessKind: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<void> {
    await this.transport.delete(
      `/v1/agent-auth/native-bridge/${encodeURIComponent(harnessKind)}`,
      options,
    );
  }
}
