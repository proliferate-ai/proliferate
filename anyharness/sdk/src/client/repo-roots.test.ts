import { describe, expect, it } from "vitest";

import type { ReadWorkspaceFileResponse } from "../types/files.js";
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
