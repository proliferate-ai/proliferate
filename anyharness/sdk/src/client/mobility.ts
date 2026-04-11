import type {
  ExportWorkspaceMobilityArchiveRequest,
  InstallWorkspaceMobilityArchiveRequest,
  InstallWorkspaceMobilityArchiveResponse,
  UpdateWorkspaceMobilityRuntimeStateRequest,
  WorkspaceMobilityArchive,
  WorkspaceMobilityCleanupRequest,
  WorkspaceMobilityCleanupResponse,
  WorkspaceMobilityPreflightResponse,
  WorkspaceMobilityRuntimeState,
} from "../types/mobility.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

export class MobilityClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async preflight(
    workspaceId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkspaceMobilityPreflightResponse> {
    return this.transport.post<WorkspaceMobilityPreflightResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/mobility/preflight`,
      {},
      options,
    );
  }

  async updateRuntimeState(
    workspaceId: string,
    input: UpdateWorkspaceMobilityRuntimeStateRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkspaceMobilityRuntimeState> {
    return this.transport.put<WorkspaceMobilityRuntimeState>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/mobility/runtime-state`,
      input,
      options,
    );
  }

  async exportArchive(
    workspaceId: string,
    input: ExportWorkspaceMobilityArchiveRequest = {},
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkspaceMobilityArchive> {
    return this.transport.post<WorkspaceMobilityArchive>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/mobility/export`,
      input,
      options,
    );
  }

  async installArchive(
    workspaceId: string,
    archive: WorkspaceMobilityArchive | InstallWorkspaceMobilityArchiveRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<InstallWorkspaceMobilityArchiveResponse> {
    const body = "archive" in archive ? archive : { archive };
    return this.transport.post<InstallWorkspaceMobilityArchiveResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/mobility/install`,
      body,
      options,
    );
  }

  async cleanup(
    workspaceId: string,
    input: WorkspaceMobilityCleanupRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkspaceMobilityCleanupResponse> {
    return this.transport.post<WorkspaceMobilityCleanupResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/mobility/cleanup`,
      input,
      options,
    );
  }
}
