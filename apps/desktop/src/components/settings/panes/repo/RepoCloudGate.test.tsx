// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RepoCloudGate } from "./RepoCloudGate";

const gateMocks = vi.hoisted(() => ({
  activeOrganizationId: "org-1" as string | null,
  authorize: vi.fn(),
  install: vi.fn(),
  openInstallationSettings: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("@/hooks/organizations/facade/use-active-organization", () => ({
  useActiveOrganization: () => ({
    activeOrganizationId: gateMocks.activeOrganizationId,
  }),
}));

vi.mock("@/hooks/settings/workflows/use-github-app-user-authorization", () => ({
  useGitHubAppUserAuthorization: () => ({
    authorize: gateMocks.authorize,
    authorizing: false,
    error: null,
  }),
}));

vi.mock("@/hooks/settings/workflows/use-github-app-installation", () => ({
  useGitHubAppInstallation: () => ({
    install: gateMocks.install,
    openInstallationSettings: gateMocks.openInstallationSettings,
    installing: false,
    error: null,
  }),
}));

function renderGate(status: string, action: string | null, message: string | null = null) {
  const editor = {
    cloudRepository: { gitOwner: "acme", gitRepoName: "rocket" },
    cloudEnvironment: null,
    repoConfigsLoading: false,
    authority: {
      isLoading: false,
      isError: false,
      data: { authorized: false, status, action, message },
      refetch: gateMocks.refetch,
    },
  } as any;

  return render(
    <RepoCloudGate
      editor={editor}
      cloudEnabled
      cloudActive
      cloudSignInChecking={false}
      cloudSignInAvailable
    >
      <div>Cloud settings</div>
    </RepoCloudGate>,
  );
}

function renderAuthorityQueryError() {
  const editor = {
    cloudRepository: { gitOwner: "acme", gitRepoName: "rocket" },
    cloudEnvironment: null,
    repoConfigsLoading: false,
    authority: {
      isLoading: false,
      isError: true,
      data: undefined,
      refetch: gateMocks.refetch,
    },
  } as any;

  return render(
    <RepoCloudGate
      editor={editor}
      cloudEnabled
      cloudActive
      cloudSignInChecking={false}
      cloudSignInAvailable
    >
      <div>Cloud settings</div>
    </RepoCloudGate>,
  );
}

describe("RepoCloudGate GitHub App actions", () => {
  beforeEach(() => {
    gateMocks.activeOrganizationId = "org-1";
    gateMocks.authorize.mockReset();
    gateMocks.install.mockReset();
    gateMocks.openInstallationSettings.mockReset();
    gateMocks.refetch.mockReset();
  });

  afterEach(cleanup);

  it("infers an install action when an older authority response omits it", () => {
    renderGate("missing_installation", null);

    fireEvent.click(screen.getByRole("button", { name: "Install Proliferate GitHub App" }));
    expect(gateMocks.install).toHaveBeenCalledOnce();
  });

  it("infers a connect action when user authorization is missing", () => {
    renderGate("missing_user_authorization", null);

    fireEvent.click(screen.getByRole("button", { name: "Connect GitHub App" }));
    expect(gateMocks.authorize).toHaveBeenCalledOnce();
  });

  it("offers retry instead of a passive access-needed state", () => {
    renderGate("error", null, "Could not refresh GitHub App authorization.");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(gateMocks.refetch).toHaveBeenCalledOnce();
  });

  it("offers retry when the authority query rejects before returning data", () => {
    renderAuthorityQueryError();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(gateMocks.refetch).toHaveBeenCalledOnce();
  });
});
