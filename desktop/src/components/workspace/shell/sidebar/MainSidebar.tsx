import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SidebarFooter } from "./SidebarFooter";
import { SidebarRowSurface } from "./SidebarRowSurface";
import {
  DEFAULT_REPO_GROUP_ITEM_LIMIT,
  SidebarWorkspaceContent,
} from "./SidebarWorkspaceContent";
import { CoworkThreadsSection } from "@/components/workspace/cowork/sidebar/CoworkThreadsSection";
import { NewCloudWorkspaceModal } from "@/components/workspace/cloud/NewCloudWorkspaceModal";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { PopoverButton } from "@/components/ui/PopoverButton";
import type { NewCloudWorkspaceSeed } from "@/lib/domain/workspaces/cloud-workspace-creation";
import {
  Archive,
  Check,
  Filter,
  FolderPlusFilled,
  ProliferateIcon,
} from "@/components/ui/icons";
import { CAPABILITY_COPY } from "@/config/capabilities";
import { useCloudAvailabilityState } from "@/hooks/cloud/use-cloud-availability-state";
import { useCloudBilling } from "@/hooks/cloud/use-cloud-billing";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useWorkspaceDisplayNameActions } from "@/hooks/workspaces/use-workspace-display-name-actions";
import { useWorkspaceSidebarActions } from "@/hooks/workspaces/use-workspace-sidebar-actions";
import { useWorkspaceSidebarState } from "@/hooks/workspaces/use-workspace-sidebar-state";
import { useRepoSetupModalStore } from "@/stores/ui/repo-setup-modal-store";
import { RepoSetupModal } from "@/components/workspace/repo-setup/RepoSetupModal";
import { useStartCloudWorkspaceFlow } from "@/hooks/cloud/use-start-cloud-workspace-flow";

const SECTION_BTN =
  "flex h-6 w-6 items-center justify-center overflow-hidden rounded-md p-1 text-foreground opacity-75 hover:opacity-100 hover:bg-sidebar-accent";

export function MainSidebar() {
  const actions = useWorkspaceSidebarActions();
  const {
    cloudActive,
    cloudUnavailable,
  } = useCloudAvailabilityState();
  const { data: billingPlan } = useCloudBilling();
  const [showArchived, setShowArchived] = useState(false);
  const pendingWorkspaceEntry = useHarnessStore((state) => state.pendingWorkspaceEntry);
  const {
    groups,
    selectedWorkspaceId,
    isEmpty,
    isLoading,
  } = useWorkspaceSidebarState({ showArchived });

  const navigate = useNavigate();
  const archiveWorkspace = useWorkspaceUiStore((s) => s.archiveWorkspace);
  const archiveWorkspaces = useWorkspaceUiStore((s) => s.archiveWorkspaces);
  const unarchiveWorkspace = useWorkspaceUiStore((s) => s.unarchiveWorkspace);
  const { updateWorkspaceDisplayName } = useWorkspaceDisplayNameActions();
  const handleRenameWorkspace = useCallback(
    (workspaceId: string, displayName: string | null) =>
      updateWorkspaceDisplayName({ workspaceId, displayName }),
    [updateWorkspaceDisplayName],
  );
  const [cloudDialogState, setCloudDialogState] = useState<NewCloudWorkspaceSeed | null>(null);
  const repoSetupModal = useRepoSetupModalStore((s) => s.modal);
  const closeRepoSetupModal = useRepoSetupModalStore((s) => s.close);
  const startCloudWorkspaceFlow = useStartCloudWorkspaceFlow({
    onOpenCloudDialog: setCloudDialogState,
  });

  // Ephemeral, session-scoped set of repo keys the user has explicitly
  // expanded via "Show more". Toggles on/off. Resets on reload so the
  // 6-item default reasserts itself.
  const [explicitlyExpandedRepoKeys, setExplicitlyExpandedRepoKeys] = useState<
    Set<string>
  >(() => new Set());
  const handleToggleRepoExpansion = useCallback((sourceRoot: string) => {
    setExplicitlyExpandedRepoKeys((prev) => {
      const next = new Set(prev);
      if (next.has(sourceRoot)) {
        next.delete(sourceRoot);
      } else {
        next.add(sourceRoot);
      }
      return next;
    });
  }, []);

  // Force-expand any group whose currently selected workspace would be
  // hidden by the cap, so the selection is always visible. Unions the
  // user's explicit expansions with the force-expansion set.
  const effectiveExpandedRepoKeys = useMemo(() => {
    if (!selectedWorkspaceId) return explicitlyExpandedRepoKeys;
    let next: Set<string> | null = null;
    for (const group of groups) {
      if (group.items.length <= DEFAULT_REPO_GROUP_ITEM_LIMIT) continue;
      if (explicitlyExpandedRepoKeys.has(group.sourceRoot)) continue;
      const idx = group.items.findIndex((item) => item.id === selectedWorkspaceId);
      if (idx >= DEFAULT_REPO_GROUP_ITEM_LIMIT) {
        if (!next) next = new Set(explicitlyExpandedRepoKeys);
        next.add(group.sourceRoot);
      }
    }
    return next ?? explicitlyExpandedRepoKeys;
  }, [explicitlyExpandedRepoKeys, groups, selectedWorkspaceId]);

  const handleRemoveRepo = useCallback((sourceRoot: string) => {
    // Archive all workspaces in this repo group to hide it from the sidebar.
    // This is a soft remove — workspaces are archived, not deleted.
    const group = groups.find((g) => g.sourceRoot === sourceRoot);
    if (group) {
      archiveWorkspaces(group.items.map((item) => item.id));
    }
  }, [groups, archiveWorkspaces]);

  const handleOpenRepoSettings = useCallback((sourceRoot: string) => {
    navigate(`/settings?section=repo&repo=${encodeURIComponent(sourceRoot)}`);
  }, [navigate]);

  const cloudWorkspaceBlocked = billingPlan?.billingMode === "enforce" && billingPlan.blocked;
  const cloudWorkspaceTooltip = cloudUnavailable
    ? CAPABILITY_COPY.cloudDisabledTooltip
    : cloudWorkspaceBlocked
      ? billingPlan?.blockedReason ?? "Cloud usage is paused. Reach out to Pablo for unlimited cloud."
      : CAPABILITY_COPY.cloudSignInTooltip;

  return (
    <div className="h-full bg-sidebar select-none flex flex-col gap-2 pb-2 pt-2">
      <div className="flex flex-col flex-1 min-h-0 w-full min-w-0">
        {/* Top actions */}
        <div className="px-2">
          <div className="flex flex-col gap-px">
            <SidebarRowSurface
              active={!selectedWorkspaceId && !pendingWorkspaceEntry}
              onPress={actions.handleGoHome}
              className="px-2 py-1"
            >
              <div className="flex min-w-0 items-center text-base gap-2 flex-1 text-foreground">
                <ProliferateIcon className="size-3 shrink-0" />
                <span className="truncate">Home</span>
              </div>
            </SidebarRowSurface>
          </div>
        </div>

        <div className="relative overflow-hidden flex-1 w-full min-w-0 min-h-0">
          <AutoHideScrollArea
            className="h-full"
            viewportClassName="px-2 pt-0.5 pb-4"
            contentClassName="w-full min-w-0 flex flex-col gap-px"
          >
            <CoworkThreadsSection />

            {/* Repositories heading */}
            <div className="text-foreground/50 text-base opacity-75 pl-4 pr-2 pt-3 pb-1">
              <div className="flex items-center justify-between gap-2">
                <span>Repositories</span>
                <div className="flex items-center gap-1">
                  <PopoverButton
                    trigger={
                      <button
                        type="button"
                        title="Filter repositories"
                        className={SECTION_BTN}
                      >
                        <Filter className="size-3" />
                      </button>
                    }
                  >
                    {(close) => (
                      <button
                        type="button"
                        onClick={() => {
                          setShowArchived((v) => !v);
                          close();
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground hover:bg-sidebar-accent"
                      >
                        <Archive className="size-3.5 shrink-0" />
                        <span className="flex-1 truncate text-left">Archived workspaces</span>
                        {showArchived && <Check className="size-3.5 shrink-0 text-foreground/60" />}
                      </button>
                    )}
                  </PopoverButton>
                  <button
                    type="button"
                    onClick={actions.handleAddRepo}
                    title="Add repository"
                    className={SECTION_BTN}
                  >
                    <FolderPlusFilled className="size-3" />
                  </button>
                </div>
              </div>
            </div>

            <SidebarWorkspaceContent
              isEmpty={isEmpty}
              isLoading={isLoading}
              groups={groups}
              explicitlyExpandedRepoKeys={explicitlyExpandedRepoKeys}
              effectiveExpandedRepoKeys={effectiveExpandedRepoKeys}
              onToggleRepoExpansion={handleToggleRepoExpansion}
              cloudWorkspaceEnabled={cloudActive && !cloudWorkspaceBlocked}
              cloudWorkspaceTooltip={cloudWorkspaceTooltip}
              onCreateWorktreeWorkspace={actions.handleCreateWorktreeWorkspace}
              onCreateLocalWorkspace={actions.handleCreateLocalWorkspace}
              onOpenCloudDialog={(seed) => {
                void startCloudWorkspaceFlow(seed);
              }}
              onSelectWorkspace={actions.handleSelectWorkspace}
              onArchiveWorkspace={archiveWorkspace}
              onUnarchiveWorkspace={unarchiveWorkspace}
              onRenameWorkspace={handleRenameWorkspace}
              onRemoveRepo={handleRemoveRepo}
              onOpenRepoSettings={handleOpenRepoSettings}
            />
          </AutoHideScrollArea>
        </div>
      </div>

      <SidebarFooter />

      {cloudActive && !cloudWorkspaceBlocked && cloudDialogState && (
        <NewCloudWorkspaceModal
          seed={cloudDialogState}
          onClose={() => setCloudDialogState(null)}
        />
      )}

      {repoSetupModal && (
        <RepoSetupModal
          workspaceId={repoSetupModal.workspaceId}
          sourceRoot={repoSetupModal.sourceRoot}
          repoName={repoSetupModal.repoName}
          onClose={closeRepoSetupModal}
        />
      )}
    </div>
  );
}
