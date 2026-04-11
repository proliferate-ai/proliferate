import type {
  CreateCoworkWorkspaceRequest,
  CreateCoworkWorkspaceResponse,
  CreateWorkspaceRequest,
  CreateWorktreeWorkspaceRequest,
  CreateWorktreeWorkspaceResponse,
  DetectProjectSetupResponse,
  GetSetupStatusResponse,
  RegisterRepoWorkspaceRequest,
  ReplaceWorkspaceDefaultSessionRequest,
  ReplaceWorkspaceDefaultSessionResponse,
  ResolveWorkspaceFromPathRequest,
  StartWorkspaceSetupRequest,
  UpdateWorkspaceDisplayNameRequest,
  Workspace,
  WorkspaceSurfaceKind,
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

  async createCowork(
    input: CreateCoworkWorkspaceRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<CreateCoworkWorkspaceResponse> {
    return this.transport.post<CreateCoworkWorkspaceResponse>(
      "/v1/workspaces:cowork",
      input,
      options,
    );
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

  async list(surfaceKind?: WorkspaceSurfaceKind): Promise<Workspace[]> {
    const query = surfaceKind
      ? `?surfaceKind=${encodeURIComponent(surfaceKind)}`
      : "";
    return this.transport.get<Workspace[]>(`/v1/workspaces${query}`);
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

  async replaceDefaultSession(
    workspaceId: string,
    input: ReplaceWorkspaceDefaultSessionRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<ReplaceWorkspaceDefaultSessionResponse> {
    return this.transport.post<ReplaceWorkspaceDefaultSessionResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/default-session:replace`,
      input,
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
