import type {
  CoworkArtifactDetailResponse,
  CoworkArtifactManifestResponse,
  CoworkStatus,
  CoworkThread,
  CreateCoworkThreadRequest,
  CreateCoworkThreadResponse,
} from "../types/cowork.js";
import { normalizeSession } from "../types/sessions.js";
import type { AnyHarnessTransport } from "./core.js";

export class CoworkClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async getStatus(): Promise<CoworkStatus> {
    return this.transport.get<CoworkStatus>("/v1/cowork");
  }

  async enable(): Promise<CoworkStatus> {
    return this.transport.post<CoworkStatus>("/v1/cowork/enable", {});
  }

  async listThreads(): Promise<CoworkThread[]> {
    return this.transport.get<CoworkThread[]>("/v1/cowork/threads");
  }

  async getManifest(workspaceId: string): Promise<CoworkArtifactManifestResponse> {
    return this.transport.get<CoworkArtifactManifestResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/cowork/manifest`,
    );
  }

  async getArtifact(
    workspaceId: string,
    artifactId: string,
  ): Promise<CoworkArtifactDetailResponse> {
    return this.transport.get<CoworkArtifactDetailResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/cowork/artifacts/${encodeURIComponent(artifactId)}`,
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
