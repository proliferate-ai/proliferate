import { Fragment, useState } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { ArrowLeft } from "@/components/ui/icons";
import { SupportDialog } from "@/components/support/SupportDialog";
import {
  SETTINGS_COPY,
  SETTINGS_NAV_GROUPS,
  type SettingsSection,
  type SettingsNavItem,
} from "@/config/settings";
import { useAppVersion } from "@/hooks/settings/use-app-version";
import type { UpdaterPhase } from "@/hooks/updater/use-updater";

interface SettingsSidebarProps {
  activeSection: SettingsSection;
  disabledSections?: Partial<Record<SettingsSection, boolean>>;
  onNavigateHome: () => void;
  onSelectSection: (section: SettingsSection) => void;
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
  "h-auto w-full justify-start gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-all hover:bg-sidebar-accent focus:outline-none";
const NAV_ITEM_ACTIVE = `${NAV_ITEM_BASE} bg-sidebar-accent font-medium text-sidebar-foreground`;
const NAV_ITEM_INACTIVE = `${NAV_ITEM_BASE} text-sidebar-muted-foreground`;
const NAV_STATUS_CLASS = "ml-auto shrink-0 text-xs text-sidebar-muted-foreground";
const NAV_GROUP_CLASS = "flex flex-col gap-0.5";
const NAV_GROUP_SPACING_CLASS = "mt-3";

export function SettingsSidebar({
  activeSection,
  disabledSections,
  onNavigateHome,
  onSelectSection,
  onCheckForUpdates,
  onDownloadUpdate,
  onOpenRestartPrompt,
  updateActionState,
}: SettingsSidebarProps) {
  const location = useLocation();
  const [supportOpen, setSupportOpen] = useState(false);
  const appVersion = useAppVersion().data?.trim();

  function handleItemClick(item: SettingsNavItem) {
    if (item.kind === "action") {
      if (item.id === "support") {
        setSupportOpen(true);
        return;
      }

      if (item.id === "checkForUpdates") {
        if (!updateActionState.updatesSupported) {
          return;
        }
        onCheckForUpdates();
      }
      return;
    }

    onSelectSection(item.id);
  }

  function isItemActive(item: SettingsNavItem) {
    return item.kind === "section" && activeSection === item.id;
  }

  function renderUpdateCommand() {
    if (
      updateActionState.phase !== "available"
      && updateActionState.phase !== "downloading"
      && updateActionState.phase !== "ready"
    ) {
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
      <Button
        type="button"
        variant="ghost"
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
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className={NAV_STATUS_CLASS}>{status}</span>
      </Button>
    );
  }

  return (
    <div className="flex w-64 flex-col border-r border-sidebar-border bg-sidebar">
      <SupportDialog
        open={supportOpen}
        onClose={() => setSupportOpen(false)}
        context={{
          source: "settings",
          intent: "general",
          pathname: `${location.pathname}${location.search}`,
        }}
      />
      <div className="h-10 pl-[82px]" data-tauri-drag-region="true" />

      <Button
        type="button"
        variant="ghost"
        onClick={onNavigateHome}
        className="mx-1.5 mb-4 h-auto w-fit justify-start gap-2 bg-transparent px-2 py-1.5 text-sm text-sidebar-muted-foreground transition-colors hover:bg-transparent hover:text-sidebar-foreground"
      >
        <ArrowLeft className="size-4" />
        <span>{SETTINGS_COPY.back}</span>
      </Button>

      <nav className="flex-1 overflow-y-auto px-1.5 pb-4">
        <div className="flex flex-col">
          {SETTINGS_NAV_GROUPS.map((group, index) => (
            <Fragment key={group.id}>
              <div
                className={`${NAV_GROUP_CLASS} ${index > 0 ? NAV_GROUP_SPACING_CLASS : ""}`}
              >
                <div className="px-2 py-1.5 text-sm text-sidebar-muted-foreground">
                  {group.heading}
                </div>
                {group.items.map((item) => {
                  const active = isItemActive(item);
                  const sectionDisabled =
                    item.kind === "section" && !!disabledSections?.[item.id];
                  const Icon = item.icon;
                  const actionDisabled =
                    item.kind === "action"
                    && item.id === "checkForUpdates"
                    && !updateActionState.updatesSupported;
                  const disabled = sectionDisabled || actionDisabled;
                  return (
                    <Fragment key={item.id}>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => handleItemClick(item)}
                        className={`${active ? NAV_ITEM_ACTIVE : NAV_ITEM_INACTIVE} ${
                          disabled ? "cursor-not-allowed opacity-60 hover:bg-transparent" : ""
                        }`}
                        aria-current={active ? "page" : undefined}
                        aria-disabled={disabled || undefined}
                        disabled={disabled}
                      >
                        <Icon className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.kind === "action" && item.id === "checkForUpdates" && (
                          <span className={NAV_STATUS_CLASS}>
                            {!updateActionState.updatesSupported
                              ? "Packaged only"
                              : updateActionState.isChecking
                                ? "Checking..."
                                : updateActionState.hasAvailableUpdate
                                  ? "Available"
                                  : ""}
                          </span>
                        )}
                      </Button>
                      {item.kind === "action" && item.id === "checkForUpdates"
                        ? renderUpdateCommand()
                        : null}
                    </Fragment>
                  );
                })}
              </div>
            </Fragment>
          ))}
        </div>
      </nav>
      {appVersion ? (
        <div className="shrink-0 border-t border-sidebar-border px-3 py-2 text-xs text-sidebar-muted-foreground">
          Proliferate v{appVersion}
        </div>
      ) : null}
    </div>
  );
}
