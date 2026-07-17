import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { invalidateCloudRepoEnvironmentRemoval } from "@proliferate/cloud-sdk-react";

describe("cloud repository removal invalidation", () => {
  it("invalidates every repository authority and environment consumer", async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();

    await invalidateCloudRepoEnvironmentRemoval(queryClient, "https://api.example.test", {
      gitOwner: "acme",
      gitRepoName: "rocket",
    });

    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ["cloud", "repositories"],
      ["cloud", "git-repositories"],
      ["cloud", "github-app", "https://api.example.test"],
      ["cloud", "secrets", "repos", "acme", "rocket"],
    ]);
  });
});
