import type {
  ListWorkspaceFilesResponse,
  SearchWorkspaceFilesResponse,
  ReadWorkspaceFileResponse,
  StatWorkspaceFileResponse,
  WriteWorkspaceFileRequest,
  WriteWorkspaceFileResponse,
} from "../types/files.js";
import { withTimingCategory, type AnyHarnessRequestOptions, type AnyHarnessTransport } from "./core.js";

export class FilesClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async list(
    workspaceId: string,
    path = "",
    options?: AnyHarnessRequestOptions,
  ): Promise<ListWorkspaceFilesResponse> {
    const query = path ? `?path=${encodeURIComponent(path)}` : "";
    return this.transport.get<ListWorkspaceFilesResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/files/entries${query}`,
      withTimingCategory(options, "file.list"),
    );
  }

  async search(
    workspaceId: string,
    query = "",
    limit = 50,
    options?: AnyHarnessRequestOptions,
  ): Promise<SearchWorkspaceFilesResponse> {
    const params = new URLSearchParams();
    if (query) {
      params.set("q", query);
    }
    params.set("limit", String(limit));

    return this.transport.get<SearchWorkspaceFilesResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/files/search?${params.toString()}`,
      withTimingCategory(options, "file.search"),
    );
  }

  async read(
    workspaceId: string,
    path: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<ReadWorkspaceFileResponse> {
    return this.transport.get<ReadWorkspaceFileResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/files/file?path=${encodeURIComponent(path)}`,
      withTimingCategory(options, "file.read"),
    );
  }

  async write(
    workspaceId: string,
    input: WriteWorkspaceFileRequest,
  ): Promise<WriteWorkspaceFileResponse> {
    return this.transport.put<WriteWorkspaceFileResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/files/file`,
      input,
    );
  }

  async stat(
    workspaceId: string,
    path: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<StatWorkspaceFileResponse> {
    return this.transport.get<StatWorkspaceFileResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/files/stat?path=${encodeURIComponent(path)}`,
      withTimingCategory(options, "file.stat"),
    );
  }
}
