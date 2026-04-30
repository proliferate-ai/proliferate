import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readRepoTrackedTextFile,
  readWorkspaceTextFile,
} from "@/lib/integrations/anyharness/files";

const clientMocks = vi.hoisted(() => ({
  filesRead: vi.fn(),
  repoRootsReadFile: vi.fn(),
  getAnyHarnessClient: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  getAnyHarnessClient: clientMocks.getAnyHarnessClient,
}));

describe("AnyHarness tracked file reads", () => {
  beforeEach(() => {
    clientMocks.filesRead.mockReset();
    clientMocks.repoRootsReadFile.mockReset();
    clientMocks.getAnyHarnessClient.mockReset();
    clientMocks.getAnyHarnessClient.mockReturnValue({
      files: { read: clientMocks.filesRead },
      repoRoots: { readFile: clientMocks.repoRootsReadFile },
    });
  });

  it("validates workspace file text responses", async () => {
    clientMocks.filesRead.mockResolvedValue({
      path: "README.md",
      kind: "file",
      content: "hello",
      versionToken: "token",
      encoding: "utf-8",
      sizeBytes: 5,
      isText: true,
      tooLarge: false,
    });

    await expect(readWorkspaceTextFile("http://runtime", "workspace", "README.md"))
      .resolves.toBe("hello");
  });

  it("rejects binary or too-large tracked files", async () => {
    clientMocks.filesRead.mockResolvedValue({
      path: "image.png",
      kind: "file",
      content: null,
      versionToken: "token",
      encoding: null,
      sizeBytes: 5,
      isText: false,
      tooLarge: false,
    });

    await expect(readWorkspaceTextFile("http://runtime", "workspace", "image.png"))
      .rejects.toThrow("Only text files up to 1 MiB can be synced");
  });

  it("chooses workspace source before repo root source", async () => {
    clientMocks.filesRead.mockResolvedValue({
      path: "config.yml",
      kind: "file",
      content: "workspace",
      versionToken: "token",
      encoding: "utf-8",
      sizeBytes: 9,
      isText: true,
      tooLarge: false,
    });

    await expect(readRepoTrackedTextFile(
      "http://runtime",
      { localWorkspaceId: "workspace", repoRootId: "repo-root" },
      "config.yml",
    )).resolves.toEqual({
      content: "workspace",
      sourceKind: "workspace",
    });
    expect(clientMocks.repoRootsReadFile).not.toHaveBeenCalled();
  });

  it("falls back to repo root source when no workspace exists", async () => {
    clientMocks.repoRootsReadFile.mockResolvedValue({
      path: "config.yml",
      kind: "file",
      content: "repo-root",
      versionToken: "token",
      encoding: "utf-8",
      sizeBytes: 9,
      isText: true,
      tooLarge: false,
    });

    await expect(readRepoTrackedTextFile(
      "http://runtime",
      { localWorkspaceId: null, repoRootId: "repo-root" },
      "config.yml",
    )).resolves.toEqual({
      content: "repo-root",
      sourceKind: "repo_root",
    });
    expect(clientMocks.repoRootsReadFile).toHaveBeenCalledWith("repo-root", "config.yml");
  });
});
