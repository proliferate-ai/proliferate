import type {
  CoworkArtifactDetailResponse,
  CoworkArtifactManifestResponse,
  CoworkManagedWorkspacesResponse,
  CoworkStatus,
  CoworkThread,
  CreateCoworkThreadRequest,
  CreateCoworkThreadResponse,
} from "../types/cowork.js";
import { normalizeSession } from "../types/sessions.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

export class CoworkClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async getStatus(options?: AnyHarnessRequestOptions): Promise<CoworkStatus> {
    return this.transport.get<CoworkStatus>("/v1/cowork", options);
  }

  async enable(): Promise<CoworkStatus> {
    return this.transport.post<CoworkStatus>("/v1/cowork/enable", {});
  }

  async listThreads(options?: AnyHarnessRequestOptions): Promise<CoworkThread[]> {
    return this.transport.get<CoworkThread[]>("/v1/cowork/threads", options);
  }

  async getManagedWorkspaces(
    sessionId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<CoworkManagedWorkspacesResponse> {
    return this.transport.get<CoworkManagedWorkspacesResponse>(
      `/v1/cowork/sessions/${encodeURIComponent(sessionId)}/managed-workspaces`,
      options,
    );
  }

  async getManifest(
    workspaceId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<CoworkArtifactManifestResponse> {
    return this.transport.get<CoworkArtifactManifestResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/cowork/manifest`,
      options,
    );
  }

  async getArtifact(
    workspaceId: string,
    artifactId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<CoworkArtifactDetailResponse> {
    return this.transport.get<CoworkArtifactDetailResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/cowork/artifacts/${encodeURIComponent(artifactId)}`,
      options,
    );
  }

  async createThread(
    input: CreateCoworkThreadRequest,
  ): Promise<CreateCoworkThreadResponse> {
    const response = await this.transport.post<CreateCoworkThreadResponse>(
      "/v1/cowork/threads",
      input,
    );
    return {
      ...response,
      session: normalizeSession(response.session),
    };
  }
}
