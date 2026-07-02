import type {
  AgentAuthStateDocument,
  ApplyAgentAuthStateResponse,
} from "../types/agent-auth.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

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
}
