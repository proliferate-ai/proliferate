// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCloudRepoActionState } from "#product/hooks/cloud/derived/use-cloud-repo-action-state";

vi.mock("@proliferate/cloud-sdk-react", async () => {
  const { useState } = await import("react");
  return {
    useGitHubRepoAuthority: () => {
      const [authority] = useState({
        data: { authorized: true, status: "authorized" },
        isError: false,
        isPending: false,
      });
      return authority;
    },
  };
});

vi.mock("#product/hooks/capabilities/derived/use-app-capabilities", () => ({
  useAppCapabilities: () => ({
    githubRepositoryAccessStatus: "ready",
    managedCloudStatus: "ready",
  }),
}));

vi.mock("#product/hooks/auth/facade/use-product-auth", () => ({
  useProductAuthStatus: () => "authenticated",
}));

vi.mock("#product/hooks/organizations/facade/use-active-organization", () => ({
  useActiveOrganization: () => ({
    activeOrganization: { membership: { role: "owner" } },
  }),
}));

vi.mock("#product/lib/domain/settings/admin-roles", () => ({
  isSettingsAdminRole: () => true,
}));

vi.mock("#product/lib/domain/settings/repositories", () => ({
  cloudRepositoryKey: (owner: string, repo: string) => `${owner}/${repo}`,
}));

vi.mock("@proliferate/product-domain/repos/repo-readiness", () => ({
  resolveRepositoryReadiness: () => ({ gate: 10 }),
}));

vi.mock("#product/lib/domain/workspaces/cloud/cloud-workspace-creation", () => ({
  cloudRepoActionStateFromReadiness: () => ({
    kind: "ready",
    label: "New cloud workspace",
    accessState: "ready",
  }),
}));

describe("useCloudRepoActionState", () => {
  it("keeps its hook order stable when a repository command target appears", () => {
    const configuredRepoKeys = new Set<string>();
    const { result, rerender } = renderHook(
      ({ repoTarget }) => useCloudRepoActionState({
        repoTarget,
        configuredRepoKeys,
        isInitialConfigLoad: false,
        cloudConnected: true,
      }),
      { initialProps: { repoTarget: null as { gitOwner: string; gitRepoName: string } | null } },
    );

    expect(result.current.kind).toBe("hidden");

    rerender({ repoTarget: { gitOwner: "proliferate-ai", gitRepoName: "proliferate" } });

    expect(result.current.kind).not.toBe("hidden");
  });
});
