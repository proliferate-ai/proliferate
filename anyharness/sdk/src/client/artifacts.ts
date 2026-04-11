import type {
  WorkspaceArtifactDetail,
  WorkspaceArtifactSummary,
} from "../types/artifacts.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

export class ArtifactsClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async listByWorkspace(
    workspaceId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkspaceArtifactSummary[]> {
    return this.transport.get<WorkspaceArtifactSummary[]>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/artifacts`,
      options,
    );
  }

  async getByWorkspace(
    workspaceId: string,
    artifactId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkspaceArtifactDetail> {
    return this.transport.get<WorkspaceArtifactDetail>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(artifactId)}`,
      options,
    );
  }

  async getContent(
    workspaceId: string,
    artifactId: string,
    relativePath: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<Response> {
    const encodedPath = encodeURIComponent(relativePath);
    return this.transport.getRaw(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(artifactId)}/content?path=${encodedPath}`,
      options,
    );
  }
}
