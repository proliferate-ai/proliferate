// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RepoCloudGate } from "#product/components/settings/panes/repo/RepoCloudGate";
import type { CloudRepoEnvironmentEditor } from "#product/hooks/settings/workflows/use-cloud-repo-environment-editor";

// PR2-GATING-01: RepoCloudGate must route its operator-configuration gate
// through the shared readiness resolver, so an operator-incomplete deployment
// shows the operator explanation — never a user-auth ("Connect GitHub App")
// CTA the user cannot act on.

const capabilities = vi.hoisted(() => ({
  value: {
    githubRepositoryAccessStatus: "ready" as string,
    managedCloudStatus: "ready" as string,
    githubRepositoryAccessDisplayName: "proliferate-app" as string | null,
  },
}));

vi.mock("#product/hooks/capabilities/derived/use-app-capabilities", () => ({
  useAppCapabilities: () => capabilities.value,
}));

vi.mock("#product/hooks/organizations/facade/use-active-organization", () => ({
  useActiveOrganization: () => ({
    activeOrganization: { name: "Acme", membership: { role: "member" } },
    activeOrganizationId: "org-1",
  }),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    links: { buildReturnUrl: () => "https://app.test/return", openExternal: vi.fn() },
    clipboard: { writeText: vi.fn() },
  }),
}));

vi.mock("#product/hooks/settings/workflows/use-github-app-user-authorization", () => ({
  useGitHubAppUserAuthorization: () => ({ authorize: vi.fn(), authorizing: false, error: null }),
}));

vi.mock("#product/hooks/settings/workflows/use-github-app-installation", () => ({
  useGitHubAppInstallation: () => ({
    install: vi.fn(),
    openInstallationSettings: vi.fn(),
    installing: false,
    error: null,
  }),
}));

function editor(overrides: Partial<CloudRepoEnvironmentEditor> = {}): CloudRepoEnvironmentEditor {
  return {
    cloudRepository: {
      sourceRoot: "acme/app",
      name: "app",
      gitOwner: "acme",
      gitRepoName: "app",
    },
    cloudEnvironment: null,
    // These fields are unused once the operator gate short-circuits the render.
    draft: {} as CloudRepoEnvironmentEditor["draft"],
    status: {} as CloudRepoEnvironmentEditor["status"],
    saving: false,
    saveError: null,
    repoConfigsLoading: false,
    authority: {
      // A "connect GitHub App" authority response — the exact user-auth CTA
      // that must NOT surface when the operator gate is unmet.
      data: { authorized: false, status: "missing_user_authorization", action: "authorize_user", message: null },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as CloudRepoEnvironmentEditor["authority"],
    branches: { defaultBranch: null, names: [], loading: false, error: null },
    save: vi.fn(),
    setUp: vi.fn(),
    ...overrides,
  } as CloudRepoEnvironmentEditor;
}

afterEach(() => {
  cleanup();
  capabilities.value = {
    githubRepositoryAccessStatus: "ready",
    managedCloudStatus: "ready",
    githubRepositoryAccessDisplayName: "proliferate-app",
  };
});

describe("RepoCloudGate operator gate (PR2-GATING-01)", () => {
  it("shows the operator-configuration explanation and NO user-auth CTA when the deployment is operator-incomplete", () => {
    capabilities.value = {
      githubRepositoryAccessStatus: "operator_configuration_required",
      managedCloudStatus: "operator_configuration_required",
      githubRepositoryAccessDisplayName: "proliferate-app",
    };

    render(
      <RepoCloudGate
        editor={editor()}
        cloudEnabled
        cloudActive
        cloudSignInChecking={false}
        cloudSignInAvailable
      >
        <div>gated-children</div>
      </RepoCloudGate>,
    );

    expect(screen.queryByText(/isn't fully configured on this deployment/)).not.toBeNull();
    // The user must NEVER see a user-auth CTA when the operator must configure.
    expect(screen.queryByRole("button", { name: /Connect GitHub App/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reconnect GitHub App/i })).toBeNull();
    expect(screen.queryByText("gated-children")).toBeNull();
  });

  it("does not short-circuit on the operator gate when capabilities are ready (falls through to the authority CTA)", () => {
    render(
      <RepoCloudGate
        editor={editor()}
        cloudEnabled
        cloudActive
        cloudSignInChecking={false}
        cloudSignInAvailable
      >
        <div>gated-children</div>
      </RepoCloudGate>,
    );

    // Ready operator config: the per-repo authority CTA is allowed to surface.
    expect(screen.queryByText("Cloud is not configured on this deployment")).toBeNull();
    expect(screen.queryByRole("button", { name: /Connect GitHub App/i })).not.toBeNull();
  });
});
