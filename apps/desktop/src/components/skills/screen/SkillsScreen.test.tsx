// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { InstalledSkill, MarketplaceSkill, WorkspaceSkill } from "@anyharness/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkillsScreen } from "@/components/skills/screen/SkillsScreen";
import { useSkillsScreen } from "@/hooks/skills/facade/use-skills-screen";

const hookMocks = vi.hoisted(() => ({
  useSkillsScreen: vi.fn(),
}));

vi.mock("@/hooks/skills/facade/use-skills-screen", () => ({
  useSkillsScreen: hookMocks.useSkillsScreen,
}));

type SkillsScreenState = ReturnType<typeof useSkillsScreen>;

const installedSkill: InstalledSkill = {
  skillId: "owner/repo/test-skill",
  sourceKind: "skills_sh",
  source: "skills.sh",
  slug: "test-skill",
  displayName: "Test Skill",
  description: "Tests local skills.",
  installUrl: null,
  sourceUrl: "https://example.test/skill",
  hash: null,
  installCount: 42,
  auditStatus: "pass",
  audits: [],
  files: [{ path: "SKILL.md", byteSize: 18 }],
  installedAt: "2026-06-27T00:00:00Z",
  updatedAt: "2026-06-27T00:00:00Z",
};

const marketplaceSkill: MarketplaceSkill = {
  skillId: "owner/repo/review-skill",
  slug: "review-skill",
  name: "Review Skill",
  description: "Reviews code.",
  source: "skills.sh",
  sourceType: "skills_sh",
  installUrl: null,
  sourceUrl: "https://example.test/review-skill",
  hash: null,
  installCount: 7,
  auditStatus: "warn",
  audits: [],
  files: [{ path: "SKILL.md", byteSize: 20 }],
  installed: false,
};

describe("SkillsScreen", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      takeRecords = () => [];
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    hookMocks.useSkillsScreen.mockReset();
  });

  it("renders installed skills and toggles workspace enablement", () => {
    const handleToggleWorkspaceSkill = vi.fn();
    const state = screenState({
      installedSkills: [installedSkill],
      workspaceSkillsById: new Map<string, WorkspaceSkill>([
        [installedSkill.skillId, { skill: installedSkill, enabled: true }],
      ]),
      selectedWorkspaceId: "workspace-1",
      handleToggleWorkspaceSkill,
    });
    hookMocks.useSkillsScreen.mockReturnValue(state);

    render(<SkillsScreen />);

    expect(screen.getByRole("heading", { level: 1, name: "Skills" })).toBeTruthy();
    expect(screen.getByText("Test Skill")).toBeTruthy();
    expect(screen.getByText("audit passed")).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", { checked: true }));

    expect(handleToggleWorkspaceSkill).toHaveBeenCalledWith(installedSkill, false);
  });

  it("renders marketplace warning confirmation before installing", () => {
    const installMarketplaceSkill = vi.fn();
    const state = screenState({
      activeTab: "marketplace",
      searchInput: "review",
      searchQuery: "review",
      marketplaceSkills: [marketplaceSkill],
      pendingInstall: marketplaceSkill,
      installMarketplaceSkill,
    });
    hookMocks.useSkillsScreen.mockReturnValue(state);

    render(<SkillsScreen />);

    expect(screen.getByText("Review Skill")).toBeTruthy();
    expect(screen.getByText("audit warning")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Install unaudited skill?" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Install anyway" }));

    expect(installMarketplaceSkill).toHaveBeenCalledWith(marketplaceSkill);
  });
});

function screenState(overrides: Partial<SkillsScreenState> = {}): SkillsScreenState {
  return {
    activeTab: "installed",
    setActiveTab: vi.fn(),
    searchInput: "",
    searchQuery: "",
    setSearchInput: vi.fn(),
    submitSearch: vi.fn(),
    pendingInstall: null,
    setPendingInstall: vi.fn(),
    installMarketplaceSkill: vi.fn(),
    requestInstall: vi.fn(),
    selectedWorkspaceId: null,
    installedSkills: [],
    marketplaceSkills: [],
    workspaceSkillsById: new Map<string, WorkspaceSkill>(),
    installedLoading: false,
    installedError: null,
    marketplaceLoading: false,
    marketplaceError: null,
    deletingSkillId: undefined,
    togglingSkillId: null,
    installingSkillId: null,
    installing: false,
    handleDeleteSkill: vi.fn(),
    handleToggleWorkspaceSkill: vi.fn(),
    openSource: vi.fn(),
    ...overrides,
  };
}
