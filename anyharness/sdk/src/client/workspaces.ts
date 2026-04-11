import type {
  CreateWorkspaceRequest,
  CreateWorktreeWorkspaceRequest,
  CreateWorktreeWorkspaceResponse,
  DetectProjectSetupResponse,
  GetSetupStatusResponse,
  RegisterRepoWorkspaceRequest,
  ResolveWorkspaceFromPathRequest,
  StartWorkspaceSetupRequest,
  UpdateWorkspaceDisplayNameRequest,
  Workspace,
  WorkspaceSessionLaunchCatalog,
} from "../types/workspaces.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

export class WorkspacesClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async resolveFromPath(path: string): Promise<Workspace> {
    return this.transport.post<Workspace>(
      "/v1/workspaces/resolve",
      { path } satisfies ResolveWorkspaceFromPathRequest,
    );
  }

  async create(input: CreateWorkspaceRequest): Promise<Workspace> {
    return this.transport.post<Workspace>("/v1/workspaces", input);
  }

  async registerRepoFromPath(path: string): Promise<Workspace> {
    return this.transport.post<Workspace>(
      "/v1/workspaces/repos",
      { path } satisfies RegisterRepoWorkspaceRequest,
    );
  }

  async createWorktree(
    input: CreateWorktreeWorkspaceRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<CreateWorktreeWorkspaceResponse> {
    return this.transport.post<CreateWorktreeWorkspaceResponse>(
      "/v1/workspaces/worktrees",
      input,
      options,
    );
  }

  async list(): Promise<Workspace[]> {
    return this.transport.get<Workspace[]>("/v1/workspaces");
  }

  async get(workspaceId: string, options?: AnyHarnessRequestOptions): Promise<Workspace> {
    return this.transport.get<Workspace>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}`,
      options,
    );
  }

  async updateDisplayName(
    workspaceId: string,
    input: UpdateWorkspaceDisplayNameRequest,
  ): Promise<Workspace> {
    return this.transport.patch<Workspace>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/display-name`,
      input,
    );
  }

  async getSessionLaunchCatalog(
    workspaceId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkspaceSessionLaunchCatalog> {
    return this.transport.get<WorkspaceSessionLaunchCatalog>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/session-launch`,
      options,
    );
  }

  async detectSetup(
    workspaceId: string,
  ): Promise<DetectProjectSetupResponse> {
    return this.transport.get<DetectProjectSetupResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/detect-setup`,
    );
  }

  async getSetupStatus(
    workspaceId: string,
  ): Promise<GetSetupStatusResponse> {
    return this.transport.get<GetSetupStatusResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/setup-status`,
    );
  }

  async rerunSetup(
    workspaceId: string,
  ): Promise<GetSetupStatusResponse> {
    return this.transport.post<GetSetupStatusResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/setup-rerun`,
      {},
    );
  }

  async startSetup(
    workspaceId: string,
    input: StartWorkspaceSetupRequest,
  ): Promise<GetSetupStatusResponse> {
    return this.transport.post<GetSetupStatusResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/setup-start`,
      input,
    );
  }
}
