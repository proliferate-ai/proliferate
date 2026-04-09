import type {
  CommitRequest,
  CommitResponse,
  GitBranchRef,
  GitDiffResponse,
  GitStatusSnapshot,
  PushRequest,
  PushResponse,
  RenameBranchRequest,
  RenameBranchResponse,
  StagePathsRequest,
  UnstagePathsRequest,
} from "../types/git.js";
import type { AnyHarnessTransport } from "./core.js";

export class GitClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async getStatus(workspaceId: string): Promise<GitStatusSnapshot> {
    return this.transport.get<GitStatusSnapshot>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/git/status`,
    );
  }

  async getDiff(workspaceId: string, path: string): Promise<GitDiffResponse> {
    return this.transport.get<GitDiffResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/git/diff?path=${encodeURIComponent(path)}`,
    );
  }

  async listBranches(workspaceId: string): Promise<GitBranchRef[]> {
    return this.transport.get<GitBranchRef[]>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/git/branches`,
    );
  }

  async renameBranch(workspaceId: string, newName: string): Promise<RenameBranchResponse> {
    return this.transport.post<RenameBranchResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/git/rename-branch`,
      { newName } satisfies RenameBranchRequest,
    );
  }

  async stagePaths(workspaceId: string, paths: string[]): Promise<void> {
    await this.transport.post<void>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/git/stage`,
      { paths } satisfies StagePathsRequest,
    );
  }

  async unstagePaths(workspaceId: string, paths: string[]): Promise<void> {
    await this.transport.post<void>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/git/unstage`,
      { paths } satisfies UnstagePathsRequest,
    );
  }

  async commit(workspaceId: string, input: CommitRequest): Promise<CommitResponse> {
    return this.transport.post<CommitResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/git/commit`,
      input,
    );
  }

  async push(workspaceId: string, input: PushRequest = {}): Promise<PushResponse> {
    return this.transport.post<PushResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/git/push`,
      input,
    );
  }
}
