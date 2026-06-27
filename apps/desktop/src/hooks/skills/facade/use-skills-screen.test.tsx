// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSkillsScreen } from "./use-skills-screen";

const sdkMocks = vi.hoisted(() => ({
  deleteSkill: vi.fn(),
  installSkill: vi.fn(),
  installedSkillsQuery: vi.fn(),
  marketplaceSkillsQuery: vi.fn(),
  updateWorkspaceSkill: vi.fn(),
  workspaceSkillsQuery: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useAnyHarnessDeleteSkillMutation: sdkMocks.deleteSkill,
  useAnyHarnessInstalledSkillsQuery: sdkMocks.installedSkillsQuery,
  useAnyHarnessInstallSkillMutation: sdkMocks.installSkill,
  useAnyHarnessMarketplaceSkillsQuery: sdkMocks.marketplaceSkillsQuery,
  useAnyHarnessUpdateWorkspaceSkillMutation: sdkMocks.updateWorkspaceSkill,
  useAnyHarnessWorkspaceSkillsQuery: sdkMocks.workspaceSkillsQuery,
}));

vi.mock("@/hooks/access/tauri/use-shell-actions", () => ({
  useTauriShellActions: () => ({
    openExternal: vi.fn(),
  }),
}));

describe("useSkillsScreen", () => {
  beforeEach(() => {
    useSessionSelectionStore.setState({
      selectedWorkspaceId: null,
      selectedLogicalWorkspaceId: null,
    });
    sdkMocks.installedSkillsQuery.mockReturnValue(queryState({
      data: { skills: [] },
      isPending: false,
    }));
    sdkMocks.workspaceSkillsQuery.mockReturnValue(queryState({ isPending: true }));
    sdkMocks.marketplaceSkillsQuery.mockReturnValue(queryState({ isPending: false }));
    sdkMocks.installSkill.mockReturnValue(mutationState());
    sdkMocks.deleteSkill.mockReturnValue(mutationState());
    sdkMocks.updateWorkspaceSkill.mockReturnValue(mutationState());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not keep installed skills loading when workspace skills are disabled", () => {
    const { result } = renderHook(() => useSkillsScreen());

    expect(sdkMocks.workspaceSkillsQuery).toHaveBeenCalledWith({
      workspaceId: null,
      enabled: false,
    });
    expect(result.current.installedLoading).toBe(false);
    expect(result.current.installedSkills).toEqual([]);
  });

  it("keeps installed skills loading while a selected workspace enablement query loads", () => {
    useSessionSelectionStore.setState({
      selectedWorkspaceId: "workspace-1",
      selectedLogicalWorkspaceId: "workspace-1",
    });

    const { result } = renderHook(() => useSkillsScreen());

    expect(sdkMocks.workspaceSkillsQuery).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      enabled: true,
    });
    expect(result.current.installedLoading).toBe(true);
  });
});

function queryState(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    error: null,
    isPending: false,
    ...overrides,
  };
}

function mutationState(overrides: Record<string, unknown> = {}) {
  return {
    isPending: false,
    mutateAsync: vi.fn(),
    variables: undefined,
    ...overrides,
  };
}
