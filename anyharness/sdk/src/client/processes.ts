import type {
  RunCommandRequest,
  RunCommandResponse,
} from "../types/processes.js";
import type { AnyHarnessTransport } from "./core.js";

export class ProcessesClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async run(
    workspaceId: string,
    input: RunCommandRequest,
  ): Promise<RunCommandResponse> {
    return this.transport.post<RunCommandResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/processes/run`,
      input,
    );
  }
}
