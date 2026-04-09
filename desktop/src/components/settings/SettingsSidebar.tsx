import type { UpdaterPhase } from "@/hooks/updater/use-updater";
import { ArrowLeft } from "@/components/ui/icons";
import {
  SETTINGS_NAV_GROUPS,
  SETTINGS_COPY,
  type SettingsNavItem,
  type SettingsStaticSection,
} from "@/config/settings";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";

interface SettingsSidebarProps {
  repositories: SettingsRepositoryEntry[];
  activeSection: SettingsStaticSection | "repo" | "cloudRepo";
  activeRepoSourceRoot: string | null;
  disabledSections?: Partial<Record<SettingsStaticSection, boolean>>;
  onNavigateHome: () => void;
  onSelectSection: (section: SettingsStaticSection) => void;
  onSelectRepo: (sourceRoot: string) => void;
  onCheckForUpdates: () => void;
  onDownloadUpdate: () => void;
  onOpenRestartPrompt: () => void;
  updateActionState: {
    availableVersion: string | null;
    downloadProgress: number | null;
    isChecking: boolean;
    hasAvailableUpdate: boolean;
    phase: UpdaterPhase;
    updatesSupported: boolean;
  };
}

const NAV_ITEM_BASE =
  "w-full flex items-center gap-3 px-2 py-1.5 text-sm text-left rounded-md transition-all hover:bg-sidebar-accent focus:outline-none";
const NAV_ITEM_ACTIVE = `${NAV_ITEM_BASE} bg-sidebar-accent font-medium text-sidebar-foreground`;
const NAV_ITEM_INACTIVE = `${NAV_ITEM_BASE} text-muted-foreground`;

export function SettingsSidebar({
  repositories,
  activeSection,
  activeRepoSourceRoot,
  disabledSections,
  onNavigateHome,
  onSelectSection,
  onSelectRepo,
  onCheckForUpdates,
  onDownloadUpdate,
  onOpenRestartPrompt,
  updateActionState,
}: SettingsSidebarProps) {
  function handleItemClick(item: SettingsNavItem) {
    if (item.kind === "action") {
      if (!updateActionState.updatesSupported) {
        return;
      }
      onCheckForUpdates();
    } else {
      onSelectSection(item.id);
    }
  }

  function isItemActive(item: SettingsNavItem) {
    return item.kind === "section"
      && (activeSection === item.id || (item.id === "cloud" && activeSection === "cloudRepo"));
  }

  function renderUpdateCommand() {
    if (updateActionState.phase !== "available" && updateActionState.phase !== "downloading" && updateActionState.phase !== "ready") {
      return null;
    }

    const disabled = updateActionState.phase === "downloading";
    const label =
      updateActionState.phase === "ready"
        ? "Restart to update"
        : updateActionState.phase === "downloading"
          ? "Downloading update"
          : "Download update";
    const status =
      updateActionState.phase === "ready"
        ? "Ready"
        : updateActionState.phase === "downloading"
          ? `${updateActionState.downloadProgress ?? 0}%`
          : updateActionState.availableVersion
            ? `v${updateActionState.availableVersion}`
            : "Available";

    return (
      <button
        type="button"
        onClick={() => {
          if (disabled) {
            return;
          }
          if (updateActionState.phase === "ready") {
            onOpenRestartPrompt();
            return;
          }
          onDownloadUpdate();
        }}
        className={`${NAV_ITEM_INACTIVE} ${disabled ? "cursor-not-allowed opacity-60 hover:bg-transparent" : ""}`}
        aria-disabled={disabled || undefined}
        disabled={disabled}
      >
        <span className="flex-1">{label}</span>
        <span className="text-base text-muted-foreground">{status}</span>
      </button>
    );
  }

  return (
    <div className="flex w-64 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="h-10 pl-[82px]" data-tauri-drag-region="true" />

      <button
        type="button"
        onClick={onNavigateHome}
        className="mx-1.5 mb-4 flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
      >
        <ArrowLeft className="size-4" />
        <span>{SETTINGS_COPY.back}</span>
      </button>

      <nav className="flex-1 overflow-y-auto px-1.5 pb-4">
        <div className="flex flex-col gap-4">
          {SETTINGS_NAV_GROUPS.map((group) => (
            <div key={group.id} className="flex flex-col gap-0.5">
              {group.heading && (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  {group.heading}
                </div>
              )}
              {group.items.map((item) => {
                const active = isItemActive(item);
                const sectionDisabled =
                  item.kind === "section" && !!disabledSections?.[item.id];
                const Icon = item.icon;
                const actionDisabled =
                  item.kind === "action" && !updateActionState.updatesSupported;
                const disabled = sectionDisabled || actionDisabled;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleItemClick(item)}
                    className={`${active ? NAV_ITEM_ACTIVE : NAV_ITEM_INACTIVE} ${
                      disabled ? "cursor-not-allowed opacity-60 hover:bg-transparent" : ""
                    }`}
                    aria-current={active ? "page" : undefined}
                    aria-disabled={disabled || undefined}
                    disabled={disabled}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {item.kind === "action" && (
                      <span className="text-base text-muted-foreground">
                        {!updateActionState.updatesSupported
                          ? "Packaged only"
                          : updateActionState.isChecking
                          ? "Checking…"
                          : updateActionState.hasAvailableUpdate
                            ? "Available"
                            : ""}
                      </span>
                    )}
                  </button>
                );
              })}
              {group.id === "cloud" && renderUpdateCommand()}
            </div>
          ))}

          {repositories.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                Repos
              </div>
              {repositories.map((repository) => {
                const active =
                  activeSection === "repo" &&
                  activeRepoSourceRoot === repository.sourceRoot;
                const letter = (repository.name[0] ?? "?").toUpperCase();
                return (
                  <button
                    key={repository.sourceRoot}
                    type="button"
                    onClick={() => onSelectRepo(repository.sourceRoot)}
                    className={active ? NAV_ITEM_ACTIVE : NAV_ITEM_INACTIVE}
                    aria-current={active ? "page" : undefined}
                    title={repository.sourceRoot}
                  >
                    <div className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] font-medium text-muted-foreground">
                      {letter}
                    </div>
                    <span className="w-0 flex-1 truncate">{repository.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </nav>
    </div>
  );
}
