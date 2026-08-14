import type {
  ArchiveWorkspaceRequest,
  ArchiveWorkspaceResponse,
  CreateWorkspaceRequest,
  CreateWorktreeWorkspaceRequest,
  CreateWorktreeWorkspaceResponse,
  DetectProjectSetupResponse,
  GetSetupStatusResponse,
  ResolveWorkspaceFromPathRequest,
  ResolveWorkspaceResponse,
  RestoreWorktreeWorkspaceResponse,
  StartWorkspaceSetupRequest,
  UnarchiveWorkspaceRequest,
  UnarchiveWorkspaceResponse,
  UpdateWorkspaceDisplayNameRequest,
  Workspace,
  WorkspaceLifecycleFilter,
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

  /**
   * The workspace list. Defaults to `active` on the server, so an old client
   * keeps seeing exactly what it saw before archiving shipped; pass `archived`
   * or `all` to widen it.
   */
  async list(
    lifecycle?: WorkspaceLifecycleFilter,
    options?: AnyHarnessRequestOptions,
  ): Promise<Workspace[]> {
    const query = lifecycle === undefined
      ? ""
      : `?lifecycle=${encodeURIComponent(lifecycle)}`;
    return this.transport.get<Workspace[]>(
      `/v1/workspaces${query}`,
      withTimingCategory(options, "workspace.list"),
    );
  }

  /**
   * Archive a workspace. Resolves at the row flip — the archive script, the
   * worktree removal, and the branch delete all run detached afterwards and
   * cannot change this answer.
   */
  async archive(
    workspaceId: string,
    input?: ArchiveWorkspaceRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<ArchiveWorkspaceResponse> {
    return this.transport.post<ArchiveWorkspaceResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/archive`,
      input ?? {},
      withTimingCategory(options, "workspace.archive"),
    );
  }

  /**
   * Unarchive a workspace. An ambiguous restore answers 409
   * `WORKSPACE_UNARCHIVE_SCENARIO`, whose `extra` carries the scenario body and
   * the `strategies` the caller may answer with in `branchStrategy`/`overwrite`.
   */
  async unarchive(
    workspaceId: string,
    input?: UnarchiveWorkspaceRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<UnarchiveWorkspaceResponse> {
    return this.transport.post<UnarchiveWorkspaceResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/unarchive`,
      input ?? {},
      withTimingCategory(options, "workspace.unarchive"),
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

  async purge(
    workspaceId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkspacePurgeResponse> {
    return this.transport.deleteJson<WorkspacePurgeResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}`,
      withTimingCategory(options, "workspace.purge"),
    );
  }
}
