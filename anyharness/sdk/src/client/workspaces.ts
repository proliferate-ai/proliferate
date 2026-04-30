import type {
  CreateWorkspaceRequest,
  CreateWorktreeWorkspaceRequest,
  CreateWorktreeWorkspaceResponse,
  DetectProjectSetupResponse,
  GetSetupStatusResponse,
  ResolveWorkspaceFromPathRequest,
  ResolveWorkspaceResponse,
  StartWorkspaceSetupRequest,
  UpdateWorkspaceDisplayNameRequest,
  Workspace,
  WorkspaceSessionLaunchCatalog,
} from "../types/workspaces.js";
import { withTimingCategory, type AnyHarnessRequestOptions, type AnyHarnessTransport } from "./core.js";

export class WorkspacesClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async resolveFromPath(
    input: string | ResolveWorkspaceFromPathRequest,
  ): Promise<ResolveWorkspaceResponse> {
    const body = typeof input === "string"
      ? ({ path: input } satisfies ResolveWorkspaceFromPathRequest)
      : input;
    return this.transport.post<ResolveWorkspaceResponse>(
      "/v1/workspaces/resolve",
      body,
    );
  }

  async create(input: CreateWorkspaceRequest): Promise<ResolveWorkspaceResponse> {
    return this.transport.post<ResolveWorkspaceResponse>("/v1/workspaces", input);
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

  async list(options?: AnyHarnessRequestOptions): Promise<Workspace[]> {
    return this.transport.get<Workspace[]>(
      "/v1/workspaces",
      withTimingCategory(options, "workspace.list"),
    );
  }

  async get(workspaceId: string, options?: AnyHarnessRequestOptions): Promise<Workspace> {
    return this.transport.get<Workspace>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}`,
      withTimingCategory(options, "workspace.get"),
    );
  }

  async updateDisplayName(
    workspaceId: string,
    input: UpdateWorkspaceDisplayNameRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<Workspace> {
    return this.transport.patch<Workspace>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/display-name`,
      input,
      withTimingCategory(options, "workspace.display_name.update"),
    );
  }

  async getSessionLaunchCatalog(
    workspaceId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkspaceSessionLaunchCatalog> {
    return this.transport.get<WorkspaceSessionLaunchCatalog>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/session-launch`,
      withTimingCategory(options, "workspace.session_launch"),
    );
  }

  async detectSetup(
    workspaceId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<DetectProjectSetupResponse> {
    return this.transport.get<DetectProjectSetupResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/detect-setup`,
      withTimingCategory(options, "workspace.detect_setup"),
    );
  }

  async getSetupStatus(
    workspaceId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<GetSetupStatusResponse> {
    return this.transport.get<GetSetupStatusResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/setup-status`,
      withTimingCategory(options, "workspace.setup_status"),
    );
  }

  async rerunSetup(
    workspaceId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<GetSetupStatusResponse> {
    return this.transport.post<GetSetupStatusResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/setup-rerun`,
      {},
      withTimingCategory(options, "workspace.setup_rerun"),
    );
  }

  async startSetup(
    workspaceId: string,
    input: StartWorkspaceSetupRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<GetSetupStatusResponse> {
    return this.transport.post<GetSetupStatusResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/setup-start`,
      input,
      withTimingCategory(options, "workspace.setup_start"),
    );
  }
}
