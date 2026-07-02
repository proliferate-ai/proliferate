import type {
  CreatePullRequestRequest,
  CreatePullRequestResponse,
  CurrentPullRequestResponse,
  RepoPullRequestStatusesResponse,
} from "../types/hosting.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

export class PullRequestsClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async getCurrent(
    workspaceId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<CurrentPullRequestResponse> {
    return this.transport.get<CurrentPullRequestResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/hosting/pull-requests/current`,
      options,
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

  async listForRepoRoot(
    repoRootId: string,
    params?: { refresh?: boolean },
    options?: AnyHarnessRequestOptions,
  ): Promise<RepoPullRequestStatusesResponse> {
    const refresh = params?.refresh ? "1" : "0";
    return this.transport.get<RepoPullRequestStatusesResponse>(
      `/v1/repo-roots/${encodeURIComponent(repoRootId)}/hosting/pull-requests?refresh=${refresh}`,
      options,
    );
  }
}
