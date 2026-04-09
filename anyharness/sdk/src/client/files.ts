import type {
  ListWorkspaceFilesResponse,
  SearchWorkspaceFilesResponse,
  ReadWorkspaceFileResponse,
  StatWorkspaceFileResponse,
  WriteWorkspaceFileRequest,
  WriteWorkspaceFileResponse,
} from "../types/files.js";
import type { AnyHarnessTransport } from "./core.js";

export class FilesClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async list(workspaceId: string, path = ""): Promise<ListWorkspaceFilesResponse> {
    const query = path ? `?path=${encodeURIComponent(path)}` : "";
    return this.transport.get<ListWorkspaceFilesResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/files/entries${query}`,
    );
  }

  async search(
    workspaceId: string,
    query = "",
    limit = 50,
  ): Promise<SearchWorkspaceFilesResponse> {
    const params = new URLSearchParams();
    if (query) {
      params.set("q", query);
    }
    params.set("limit", String(limit));

    return this.transport.get<SearchWorkspaceFilesResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/files/search?${params.toString()}`,
    );
  }

  async read(workspaceId: string, path: string): Promise<ReadWorkspaceFileResponse> {
    return this.transport.get<ReadWorkspaceFileResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/files/file?path=${encodeURIComponent(path)}`,
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

  async stat(workspaceId: string, path: string): Promise<StatWorkspaceFileResponse> {
    return this.transport.get<StatWorkspaceFileResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/files/stat?path=${encodeURIComponent(path)}`,
    );
  }
}
