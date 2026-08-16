// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RepoActionsPane } from "#product/components/settings/panes/repo/RepoActionsPane";
import type { SettingsRepositoryEntry } from "#product/lib/domain/settings/repositories";

// The R7 archive-script `ScriptBlock` and rerun-setup `Switch` (§3.7) ride
// `useRepositorySettings`'s existing draft/save wiring; this test stubs that
// hook directly rather than its own deep dependency tree (repositories,
// telemetry, git branches), matching how the sibling archived-workspaces
// pane test stubs its own workflow hook.
const mocks = vi.hoisted(() => ({
  setArchiveScriptDraft: vi.fn(),
  setRerunSetupOnUnarchiveDraft: vi.fn(),
  save: vi.fn(),
  revert: vi.fn(),
  settings: {
    branches: [],
    explicitDefaultBranch: null,
    effectiveAutoDetectedBranch: null,
    setupDraft: "",
    setSetupDraft: vi.fn(),
    runCommandDraft: "",
    setRunCommandDraft: vi.fn(),
    archiveScriptDraft: "",
    setArchiveScriptDraft: vi.fn(),
    rerunSetupOnUnarchiveDraft: true,
    setRerunSetupOnUnarchiveDraft: vi.fn(),
    setExplicitDefaultBranch: vi.fn(),
    dirty: false,
    canSave: false,
    canRevert: false,
    save: vi.fn(),
    revert: vi.fn(),
  },
}));

vi.mock("#product/hooks/settings/workflows/use-repository-settings", () => ({
  useRepositorySettings: () => mocks.settings,
}));

vi.mock("@anyharness/sdk-react", () => ({
  useDetectRepoRootSetupQuery: () => ({ data: undefined, isLoading: false }),
}));

// RunCommandHelp (a sibling section rendered by this pane) reads
// useProductHost for its "open docs" link; stub it the same way
// RepoCloudGate.test.tsx does rather than mounting a real ProductHostProvider.
vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    links: { buildReturnUrl: () => "https://app.test/return", openExternal: vi.fn() },
    clipboard: { writeText: vi.fn() },
  }),
}));

const repository: SettingsRepositoryEntry = {
  sourceRoot: "/tmp/repo",
  name: "repo",
  secondaryLabel: null,
  workspaceCount: 1,
  repoRootId: "root-1",
  localWorkspaceId: "w1",
  gitProvider: null,
  gitOwner: null,
  gitRepoName: null,
  cloudConfigured: false,
  availability: "local",
};

beforeEach(() => {
  mocks.settings.archiveScriptDraft = "";
  mocks.settings.rerunSetupOnUnarchiveDraft = true;
  mocks.settings.canSave = false;
  mocks.settings.canRevert = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderLocalActions() {
  return render(
    <RepoActionsPane
      repository={repository}
      context="local"
      controlPlaneReachable={false}
      cloudActive={false}
      cloudSignInChecking={false}
      cloudSignInAvailable={false}
      onSelectRepo={vi.fn()}
      onSelectCloudEnvironment={vi.fn()}
    />,
  );
}

describe("RepoActionsPane — local Archive script + Unarchive knobs (§3.7)", () => {
  it("renders the archive-script ScriptBlock and the rerun-setup Switch", () => {
    renderLocalActions();

    expect(screen.getByRole("textbox", { name: "Local archive script" })).not.toBeNull();
    expect(screen.getByText("Run setup script on unarchive")).not.toBeNull();
    expect(screen.getByRole("switch")).not.toBeNull();
  });

  it("marks the draft dirty by forwarding archive-script edits to the hook", () => {
    renderLocalActions();

    fireEvent.change(screen.getByRole("textbox", { name: "Local archive script" }), {
      target: { value: "scripts/archive.sh" },
    });

    expect(mocks.settings.setArchiveScriptDraft).toHaveBeenCalledWith("scripts/archive.sh");
  });

  it("marks the draft dirty by forwarding the rerun-setup toggle to the hook", () => {
    renderLocalActions();

    fireEvent.click(screen.getByRole("switch"));

    expect(mocks.settings.setRerunSetupOnUnarchiveDraft).toHaveBeenCalledWith(false);
  });

  it("saves both knobs through the existing save footer", () => {
    mocks.settings.canSave = true;
    renderLocalActions();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(mocks.settings.save).toHaveBeenCalledTimes(1);
  });
});
