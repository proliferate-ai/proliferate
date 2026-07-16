import { describe, expect, it } from "vitest";

import type { ReadWorkspaceFileResponse } from "../types/files.js";
import type {
  MaterializeRepoRootRequest,
  MaterializeWorkspaceAtRefRequest,
} from "../types/repo-roots.js";
import type { AnyHarnessTransport } from "./core.js";
import { RepoRootsClient } from "./repo-roots.js";

describe("RepoRootsClient.readFile", () => {

  it("URL-encodes the repo root id and relative path", async () => {
    const calls: string[] = [];
    const response: ReadWorkspaceFileResponse = {
      path: "dir/file name.ts",
      kind: "file",
      content: "contents",
      versionToken: "token",
      encoding: "utf-8",
      sizeBytes: 8,
      isText: true,
      tooLarge: false,
    };
    const transport = {
      get: async (path: string) => {
        calls.push(path);
        return response;
      },
    } as unknown as AnyHarnessTransport;
    const client = new RepoRootsClient(transport);

    await client.readFile("repo/root", "dir/file name.ts");

    expect(calls).toEqual([
      "/v1/repo-roots/repo%2Froot/files/file?path=dir%2Ffile%20name.ts",
    ]);
  });
});

describe("RepoRootsClient materialization", () => {
  it("posts repo-root acquisition to the materializations endpoint", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const transport = {
      post: async (path: string, body: unknown) => {
        calls.push({ path, body });
        return {};
      },
    } as unknown as AnyHarnessTransport;
    const client = new RepoRootsClient(transport);

    const input: MaterializeRepoRootRequest = {
      operationId: "op-1",
      repository: {
        provider: "github",
        owner: "acme",
        name: "widget",
        cloneUrl: "https://github.com/acme/widget.git",
      },
      destinationPath: "/tmp/widget",
      mode: "clone_or_adopt",
    };
    await client.materialize(input);

    expect(calls).toEqual([
      { path: "/v1/repo-roots/materializations", body: input },
    ]);
  });

  it("URL-encodes the repo root id for workspace materialization", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const transport = {
      post: async (path: string, body: unknown) => {
        calls.push({ path, body });
        return {};
      },
    } as unknown as AnyHarnessTransport;
    const client = new RepoRootsClient(transport);

    const input: MaterializeWorkspaceAtRefRequest = {
      operationId: "op-2",
      branchName: "feature/x",
      headSha: "deadbeef",
    };
    await client.materializeWorkspaceAtRef("repo/root", input);

    expect(calls).toEqual([
      {
        path: "/v1/repo-roots/repo%2Froot/workspace-materializations",
        body: input,
      },
    ]);
  });
});
