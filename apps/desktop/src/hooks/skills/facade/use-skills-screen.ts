import { useCallback, useState } from "react";
import type { InstalledSkill, MarketplaceSkill, WorkspaceSkill } from "@anyharness/sdk";
import {
  useAnyHarnessDeleteSkillMutation,
  useAnyHarnessInstalledSkillsQuery,
  useAnyHarnessInstallSkillMutation,
  useAnyHarnessMarketplaceSkillsQuery,
  useAnyHarnessUpdateWorkspaceSkillMutation,
  useAnyHarnessWorkspaceSkillsQuery,
} from "@anyharness/sdk-react";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";

export type SkillsTab = "installed" | "marketplace";

export function useSkillsScreen() {
  const [activeTab, setActiveTab] = useState<SkillsTab>("installed");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingInstall, setPendingInstall] = useState<MarketplaceSkill | null>(null);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const showToast = useToastStore((state) => state.show);
  const { openExternal } = useTauriShellActions();

  const installedQuery = useAnyHarnessInstalledSkillsQuery();
  const workspaceSkillsQuery = useAnyHarnessWorkspaceSkillsQuery({
    workspaceId: selectedWorkspaceId,
    enabled: !!selectedWorkspaceId,
  });
  const marketplaceQuery = useAnyHarnessMarketplaceSkillsQuery({
    query: searchQuery,
    limit: 10,
    enabled: activeTab === "marketplace" && searchQuery.trim().length > 0,
  });
  const installSkill = useAnyHarnessInstallSkillMutation();
  const deleteSkill = useAnyHarnessDeleteSkillMutation();
  const updateWorkspaceSkill = useAnyHarnessUpdateWorkspaceSkillMutation();

  const workspaceSkillsById = new Map(
    (workspaceSkillsQuery.data?.skills ?? []).map((item) => [item.skill.skillId, item]),
  );
  const workspaceSkillsLoading = !!selectedWorkspaceId && workspaceSkillsQuery.isPending;

  const submitSearch = useCallback(() => {
    setSearchQuery(searchInput.trim());
  }, [searchInput]);

  const installMarketplaceSkill = useCallback(
    async (skill: MarketplaceSkill) => {
      try {
        await installSkill.mutateAsync({
          skillId: skill.skillId,
          enableForWorkspaceId: selectedWorkspaceId ?? undefined,
          allowMissingAudit: skill.auditStatus === "missing",
          allowWarningAudit: skill.auditStatus === "warn",
        });
        setPendingInstall(null);
        showToast(
          selectedWorkspaceId
            ? "Skill installed and enabled for this workspace."
            : "Skill installed.",
          "info",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to install skill.";
        showToast(message);
      }
    },
    [installSkill, selectedWorkspaceId, showToast],
  );

  const requestInstall = useCallback(
    (skill: MarketplaceSkill) => {
      if (skill.auditStatus === "fail") {
        showToast("Failed skills.sh audits block install.");
        return;
      }
      if (skill.auditStatus === "warn" || skill.auditStatus === "missing") {
        setPendingInstall(skill);
        return;
      }
      void installMarketplaceSkill(skill);
    },
    [installMarketplaceSkill, showToast],
  );

  const handleDeleteSkill = useCallback(
    async (skill: InstalledSkill) => {
      try {
        await deleteSkill.mutateAsync(skill.skillId);
        showToast("Skill uninstalled.", "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to uninstall skill.";
        showToast(message);
      }
    },
    [deleteSkill, showToast],
  );

  const handleToggleWorkspaceSkill = useCallback(
    async (skill: InstalledSkill, enabled: boolean) => {
      if (!selectedWorkspaceId) {
        showToast("Select a workspace before enabling skills.");
        return;
      }
      try {
        await updateWorkspaceSkill.mutateAsync({
          workspaceId: selectedWorkspaceId,
          skillId: skill.skillId,
          request: { enabled },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to update workspace skill.";
        showToast(message);
      }
    },
    [selectedWorkspaceId, showToast, updateWorkspaceSkill],
  );

  const openSource = useCallback(
    (url: string | null | undefined) => {
      if (!url) {
        return;
      }
      void openExternal(url).catch(() => {
        showToast("Failed to open skill source.");
      });
    },
    [openExternal, showToast],
  );

  return {
    activeTab,
    setActiveTab,
    searchInput,
    searchQuery,
    setSearchInput,
    submitSearch,
    pendingInstall,
    setPendingInstall,
    installMarketplaceSkill,
    requestInstall,
    selectedWorkspaceId,
    installedSkills: installedQuery.data?.skills ?? [],
    marketplaceSkills: marketplaceQuery.data?.skills ?? [],
    workspaceSkillsById: workspaceSkillsById as Map<string, WorkspaceSkill>,
    installedLoading: installedQuery.isPending || workspaceSkillsLoading,
    installedError: installedQuery.error ?? workspaceSkillsQuery.error,
    marketplaceLoading: marketplaceQuery.isPending,
    marketplaceError: marketplaceQuery.error,
    deletingSkillId: deleteSkill.variables,
    togglingSkillId: updateWorkspaceSkill.variables?.skillId ?? null,
    installingSkillId: installSkill.variables?.skillId ?? null,
    installing: installSkill.isPending,
    handleDeleteSkill,
    handleToggleWorkspaceSkill,
    openSource,
  };
}
