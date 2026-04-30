import type {
  DetectProjectSetupResponse,
  GitBranchRef,
  PrepareRepoRootMobilityDestinationRequest,
  PrepareRepoRootMobilityDestinationResponse,
  RepoRoot,
  ResolveRepoRootFromPathRequest,
} from "../types/repo-roots.js";
import type { ReadWorkspaceFileResponse } from "../types/files.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

export class RepoRootsClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async list(): Promise<RepoRoot[]> {
    return this.transport.get<RepoRoot[]>("/v1/repo-roots");
  }

  async resolveFromPath(path: string): Promise<RepoRoot> {
    return this.transport.post<RepoRoot>(
      "/v1/repo-roots/resolve",
      { path } satisfies ResolveRepoRootFromPathRequest,
    );
  }

  async get(repoRootId: string, options?: AnyHarnessRequestOptions): Promise<RepoRoot> {
    return this.transport.get<RepoRoot>(
      `/v1/repo-roots/${encodeURIComponent(repoRootId)}`,
      options,
    );
  }

  async listBranches(
    repoRootId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<GitBranchRef[]> {
    return this.transport.get<GitBranchRef[]>(
      `/v1/repo-roots/${encodeURIComponent(repoRootId)}/git/branches`,
      options,
    );
  }

  async readFile(repoRootId: string, path: string): Promise<ReadWorkspaceFileResponse> {
    return this.transport.get<ReadWorkspaceFileResponse>(
      `/v1/repo-roots/${encodeURIComponent(repoRootId)}/files/file?path=${encodeURIComponent(path)}`,
    );
  }

  async detectSetup(
    repoRootId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<DetectProjectSetupResponse> {
    return this.transport.get<DetectProjectSetupResponse>(
      `/v1/repo-roots/${encodeURIComponent(repoRootId)}/detect-setup`,
      options,
    );
  }

  async prepareDestination(
    repoRootId: string,
    input: PrepareRepoRootMobilityDestinationRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<PrepareRepoRootMobilityDestinationResponse> {
    return this.transport.post<PrepareRepoRootMobilityDestinationResponse>(
      `/v1/repo-roots/${encodeURIComponent(repoRootId)}/mobility/prepare-destination`,
      input,
      options,
    );
  }
}
