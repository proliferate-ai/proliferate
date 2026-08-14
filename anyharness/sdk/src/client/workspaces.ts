import type {
  CreateWorkspaceRequest,
  CreateWorktreeWorkspaceRequest,
  CreateWorktreeWorkspaceResponse,
  DetectProjectSetupResponse,
  GetSetupStatusResponse,
  ResolveWorkspaceFromPathRequest,
  ResolveWorkspaceResponse,
  RestoreWorktreeWorkspaceResponse,
  StartWorkspaceSetupRequest,
  UpdateWorkspaceDisplayNameRequest,
  Workspace,
  WorkspacePurgePreflightResponse,
  WorkspacePurgeResponse,
} from "../types/workspaces.js";
import type { WorkspaceSubagentsResponse } from "../types/subagents.js";
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

  async restoreWorktree(
    workspaceId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<RestoreWorktreeWorkspaceResponse> {
    return this.transport.post<RestoreWorktreeWorkspaceResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/worktree/restore`,
      undefined,
      withTimingCategory(options, "workspace.worktree.restore"),
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

  async listSubagents(
    workspaceId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkspaceSubagentsResponse> {
    return this.transport.get<WorkspaceSubagentsResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/subagents`,
      options,
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

  async purgePreflight(
    workspaceId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkspacePurgePreflightResponse> {
    return this.transport.get<WorkspacePurgePreflightResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/purge/preflight`,
      withTimingCategory(options, "workspace.purge.preflight"),
    );
  }

  async purge(
    workspaceId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkspacePurgeResponse> {
    return this.transport.deleteJson<WorkspacePurgeResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}`,
      withTimingCategory(options, "workspace.purge"),
    );
  }

  async retryPurge(
    workspaceId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkspacePurgeResponse> {
    return this.transport.post<WorkspacePurgeResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/purge/retry`,
      {},
      withTimingCategory(options, "workspace.purge.retry"),
    );
  }
}
