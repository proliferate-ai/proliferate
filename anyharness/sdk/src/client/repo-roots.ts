import type { RepoRoot } from "../types/repo-roots.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

export class RepoRootsClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async list(): Promise<RepoRoot[]> {
    return this.transport.get<RepoRoot[]>("/v1/repo-roots");
  }

  async get(repoRootId: string, options?: AnyHarnessRequestOptions): Promise<RepoRoot> {
    return this.transport.get<RepoRoot>(
      `/v1/repo-roots/${encodeURIComponent(repoRootId)}`,
      options,
    );
  }
}
