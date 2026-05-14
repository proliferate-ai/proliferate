import { Fragment, useState } from "react";
import { useLocation } from "react-router-dom";
import { ArrowLeft } from "@/components/ui/icons";
import { SidebarNavRow } from "@/components/ui/SidebarNavRow";
import { SupportDialog } from "@/components/support/SupportDialog";
import { SETTINGS_COPY } from "@/copy/settings/settings-copy";
import type { SettingsSection } from "@/config/settings";
import {
  SETTINGS_NAV_GROUPS,
  type SettingsNavItem,
} from "@/components/settings/settings-navigation";
import { useAppVersion } from "@/hooks/access/tauri/app/use-app-version";
import type { UpdaterPhase } from "@/hooks/access/tauri/use-updater";

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
      <SidebarNavRow
        onPress={() => {
          if (disabled) {
            return;
          }
          if (updateActionState.phase === "ready") {
            onOpenRestartPrompt();
            return;
          }
          onDownloadUpdate();
        }}
        disabled={disabled}
        label={label}
        status={status}
      />
    );
  }

  return (
    <div className="flex w-64 flex-col border-r border-sidebar-border bg-sidebar">
      {supportOpen && (
        <SupportDialog
          onClose={() => setSupportOpen(false)}
          context={{
            source: "settings",
            intent: "general",
            pathname: `${location.pathname}${location.search}`,
          }}
        />
      )}
      <div className="h-10 pl-[82px]" data-tauri-drag-region="true" />

      <div className="mb-4 px-2">
        <SidebarNavRow
          icon={<ArrowLeft className="size-4" />}
          label={SETTINGS_COPY.back}
          onPress={onNavigateHome}
        />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <div className="flex flex-col">
          {SETTINGS_NAV_GROUPS.map((group, index) => (
            <Fragment key={group.id}>
              <div
                className={`${NAV_GROUP_CLASS} ${index > 0 ? NAV_GROUP_SPACING_CLASS : ""}`}
              >
                <div className="px-2 py-1.5 text-xs font-medium uppercase tracking-[0.08em] text-sidebar-muted-foreground/80">
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
                  const status = item.kind === "action" && item.id === "checkForUpdates"
                    ? !updateActionState.updatesSupported
                      ? "Packaged only"
                      : updateActionState.isChecking
                        ? "Checking..."
                        : updateActionState.hasAvailableUpdate
                          ? "Available"
                          : ""
                    : null;
                  return (
                    <Fragment key={item.id}>
                      <SidebarNavRow
                        icon={<Icon className="size-4" />}
                        label={item.label}
                        status={status}
                        onPress={() => handleItemClick(item)}
                        active={active}
                        disabled={disabled}
                        aria-current={active ? "page" : undefined}
                      />
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
