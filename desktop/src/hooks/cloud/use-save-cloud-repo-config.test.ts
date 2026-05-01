import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTrackedFilesPayload } from "@/hooks/cloud/use-save-cloud-repo-config";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";

const clientMocks = vi.hoisted(() => ({
  filesRead: vi.fn(),
  repoRootsReadFile: vi.fn(),
  getAnyHarnessClient: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  getAnyHarnessClient: clientMocks.getAnyHarnessClient,
}));

function repository(overrides: Partial<SettingsRepositoryEntry> = {}): SettingsRepositoryEntry {
  return {
    sourceRoot: "/repo",
    name: "repo",
    secondaryLabel: null,
    workspaceCount: 0,
    repoRootId: "repo-root",
    localWorkspaceId: null,
    gitProvider: "github",
    gitOwner: "acme",
    gitRepoName: "rocket",
    ...overrides,
  };
}

describe("buildTrackedFilesPayload", () => {
  beforeEach(() => {
    clientMocks.filesRead.mockReset();
    clientMocks.repoRootsReadFile.mockReset();
    clientMocks.getAnyHarnessClient.mockReset();
    clientMocks.getAnyHarnessClient.mockReturnValue({
      files: { read: clientMocks.filesRead },
      repoRoots: { readFile: clientMocks.repoRootsReadFile },
    });
  });

  it("does not touch AnyHarness when no tracked files are configured", async () => {
    await expect(buildTrackedFilesPayload("", repository(), [])).resolves.toEqual([]);
    expect(clientMocks.getAnyHarnessClient).not.toHaveBeenCalled();
  });

  it("reads tracked files through the repo-root fallback", async () => {
    clientMocks.repoRootsReadFile.mockResolvedValue({
      path: "README.md",
      kind: "file",
      content: "hello",
      versionToken: "token",
      encoding: "utf-8",
      sizeBytes: 5,
      isText: true,
      tooLarge: false,
    });

    await expect(buildTrackedFilesPayload("http://runtime", repository(), ["README.md"]))
      .resolves.toEqual([{ relativePath: "README.md", content: "hello" }]);
    expect(clientMocks.repoRootsReadFile).toHaveBeenCalledWith("repo-root", "README.md");
  });

  it("rereads every nonempty tracked file path before saving", async () => {
    clientMocks.repoRootsReadFile
      .mockResolvedValueOnce({
        path: ".env.local",
        kind: "file",
        content: "API_KEY=abc",
        versionToken: "token-1",
        encoding: "utf-8",
        sizeBytes: 11,
        isText: true,
        tooLarge: false,
      })
      .mockResolvedValueOnce({
        path: "apps/web/.env",
        kind: "file",
        content: "WEB=1",
        versionToken: "token-2",
        encoding: "utf-8",
        sizeBytes: 5,
        isText: true,
        tooLarge: false,
      });

    await expect(buildTrackedFilesPayload("http://runtime", repository(), [
      ".env.local",
      "apps/web/.env",
    ])).resolves.toEqual([
      { relativePath: ".env.local", content: "API_KEY=abc" },
      { relativePath: "apps/web/.env", content: "WEB=1" },
    ]);
    expect(clientMocks.repoRootsReadFile).toHaveBeenCalledTimes(2);
    expect(clientMocks.repoRootsReadFile).toHaveBeenNthCalledWith(1, "repo-root", ".env.local");
    expect(clientMocks.repoRootsReadFile).toHaveBeenNthCalledWith(2, "repo-root", "apps/web/.env");
  });
});
