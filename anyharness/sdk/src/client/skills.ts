import type {
  DeleteSkillResponse,
  InstallSkillRequest,
  InstalledSkillsResponse,
  InstalledSkill,
  MarketplaceSkillSearchResponse,
  UpdateWorkspaceSkillRequest,
  WorkspaceSkill,
  WorkspaceSkillsResponse,
} from "../types/skills.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

export class SkillsClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async list(options?: AnyHarnessRequestOptions): Promise<InstalledSkillsResponse> {
    return this.transport.get<InstalledSkillsResponse>("/v1/skills", options);
  }

  async searchMarketplace(
    query: string,
    options?: { limit?: number; requestOptions?: AnyHarnessRequestOptions },
  ): Promise<MarketplaceSkillSearchResponse> {
    const params = new URLSearchParams();
    params.set("q", query);
    if (options?.limit != null) {
      params.set("limit", String(options.limit));
    }
    return this.transport.get<MarketplaceSkillSearchResponse>(
      `/v1/skills/marketplace/search?${params.toString()}`,
      options?.requestOptions,
    );
  }

  async install(
    request: InstallSkillRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<InstalledSkill> {
    return this.transport.post<InstalledSkill>(
      "/v1/skills/install",
      request,
      options,
    );
  }

  async delete(
    skillId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<DeleteSkillResponse> {
    return this.transport.deleteJson<DeleteSkillResponse>(
      `/v1/skills/${encodeURIComponent(skillId)}`,
      options,
    );
  }

  async listWorkspace(
    workspaceId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkspaceSkillsResponse> {
    return this.transport.get<WorkspaceSkillsResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/skills`,
      options,
    );
  }

  async updateWorkspaceSkill(
    workspaceId: string,
    skillId: string,
    request: UpdateWorkspaceSkillRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorkspaceSkill> {
    return this.transport.patch<WorkspaceSkill>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/skills/${encodeURIComponent(skillId)}`,
      request,
      options,
    );
  }
}
