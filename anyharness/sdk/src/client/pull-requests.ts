import type {
  CreatePullRequestRequest,
  CreatePullRequestResponse,
  CurrentPullRequestResponse,
} from "../types/hosting.js";
import type { AnyHarnessTransport } from "./core.js";

export class PullRequestsClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async getCurrent(workspaceId: string): Promise<CurrentPullRequestResponse> {
    return this.transport.get<CurrentPullRequestResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/hosting/pull-requests/current`,
    );
  }

  async create(
    workspaceId: string,
    input: CreatePullRequestRequest,
  ): Promise<CreatePullRequestResponse> {
    return this.transport.post<CreatePullRequestResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/hosting/pull-requests`,
      input,
    );
  }
}
