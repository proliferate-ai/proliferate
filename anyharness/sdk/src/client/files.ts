import type {
  ListWorkspaceFilesResponse,
  CreateWorkspaceFileEntryRequest,
  CreateWorkspaceFileEntryResponse,
  DeleteWorkspaceFileEntryResponse,
  RenameWorkspaceFileEntryRequest,
  RenameWorkspaceFileEntryResponse,
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

  async createEntry(
    workspaceId: string,
    input: CreateWorkspaceFileEntryRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<CreateWorkspaceFileEntryResponse> {
    return this.transport.post<CreateWorkspaceFileEntryResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/files/entries`,
      input,
      withTimingCategory(options, "file.create"),
    );
  }

  async createFile(
    workspaceId: string,
    path: string,
    content = "",
    options?: AnyHarnessRequestOptions,
  ): Promise<CreateWorkspaceFileEntryResponse> {
    return this.createEntry(workspaceId, { kind: "file", path, content }, options);
  }

  async createDirectory(
    workspaceId: string,
    path: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<CreateWorkspaceFileEntryResponse> {
    return this.createEntry(workspaceId, { kind: "directory", path }, options);
  }

  async renameEntry(
    workspaceId: string,
    input: RenameWorkspaceFileEntryRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<RenameWorkspaceFileEntryResponse> {
    return this.transport.patch<RenameWorkspaceFileEntryResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/files/entries`,
      input,
      withTimingCategory(options, "file.rename"),
    );
  }

  async deleteEntry(
    workspaceId: string,
    path: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<DeleteWorkspaceFileEntryResponse> {
    return this.transport.deleteJson<DeleteWorkspaceFileEntryResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/files/entries?path=${encodeURIComponent(path)}`,
      withTimingCategory(options, "file.delete"),
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
