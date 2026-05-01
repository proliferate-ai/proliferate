import { describe, expect, it } from "vitest";

import type { GitBranchDiffFilesResponse, GitDiffResponse } from "../types/git.js";
import type { AnyHarnessTransport } from "./core.js";
import { GitClient } from "./git.js";

const diffResponse: GitDiffResponse = {
  path: "dir/file name.ts",
  scope: "working_tree",
  binary: false,
  truncated: false,
  additions: 0,
  deletions: 0,
  patch: null,
};

const branchFilesResponse: GitBranchDiffFilesResponse = {
  baseRef: "origin/main",
  resolvedBaseOid: "base",
  mergeBaseOid: "merge",
  headOid: "head",
  files: [],
};

describe("GitClient diff URLs", () => {
  it("keeps the old getDiff URL shape when options are omitted", async () => {
    const calls: string[] = [];
    const transport = {
      get: async (path: string) => {
        calls.push(path);
        return diffResponse;
      },
    } as unknown as AnyHarnessTransport;
    const client = new GitClient(transport);

    await client.getDiff("workspace/1", "dir/file name.ts");

    expect(calls).toEqual([
      "/v1/workspaces/workspace%2F1/git/diff?path=dir%2Ffile%20name.ts",
    ]);
  });

  it("encodes scoped branch diff arguments", async () => {
    const calls: string[] = [];
    const transport = {
      get: async (path: string) => {
        calls.push(path);
        return diffResponse;
      },
    } as unknown as AnyHarnessTransport;
    const client = new GitClient(transport);

    await client.getDiff("workspace/1", "new file.ts", {
      scope: "branch",
      baseRef: "origin/main",
      oldPath: "old file.ts",
    });

    expect(calls).toEqual([
      "/v1/workspaces/workspace%2F1/git/diff?path=new%20file.ts&scope=branch&baseRef=origin%2Fmain&oldPath=old%20file.ts",
    ]);
  });

  it("does not encode baseRef for non-branch scopes", async () => {
    const calls: string[] = [];
    const transport = {
      get: async (path: string) => {
        calls.push(path);
        return diffResponse;
      },
    } as unknown as AnyHarnessTransport;
    const client = new GitClient(transport);

    await client.getDiff("workspace/1", "file.ts", {
      scope: "staged",
      baseRef: "main",
    });

    expect(calls).toEqual([
      "/v1/workspaces/workspace%2F1/git/diff?path=file.ts&scope=staged",
    ]);
  });

  it("encodes branch file list base refs", async () => {
    const calls: string[] = [];
    const transport = {
      get: async (path: string) => {
        calls.push(path);
        return branchFilesResponse;
      },
    } as unknown as AnyHarnessTransport;
    const client = new GitClient(transport);

    await client.listBranchDiffFiles("workspace/1", { baseRef: "origin/main" });

    expect(calls).toEqual([
      "/v1/workspaces/workspace%2F1/git/diff/branch-files?baseRef=origin%2Fmain",
    ]);
  });
});
