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

const SETTINGS_SIDEBAR_ROOT_CLASS =
  "flex h-full w-64 shrink-0 select-none flex-col bg-sidebar-background text-sidebar-foreground";
const SETTINGS_NAV_CLASS = "flex min-h-0 flex-1 flex-col px-2 pb-2";
const SETTINGS_GROUPS_CLASS = "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2";
const SETTINGS_GROUP_CLASS = "flex flex-col gap-1";
const SETTINGS_GROUP_HEADING_CLASS =
  "px-2 pb-0.5 pt-1 text-base leading-5 text-sidebar-muted-foreground opacity-75";
const SETTINGS_ROW_STACK_CLASS = "flex flex-col gap-px";

function isSettingsItemActive(item: SettingsNavItem, activeSection: SettingsSection) {
  return item.kind === "section" && activeSection === item.id;
}

function isSettingsItemDisabled(
  item: SettingsNavItem,
  disabledSections: Partial<Record<SettingsSection, boolean>> | undefined,
  updateActionState: SettingsSidebarProps["updateActionState"],
) {
  return (
    (item.kind === "section" && !!disabledSections?.[item.id])
    || (item.kind === "action"
      && item.id === "checkForUpdates"
      && !updateActionState.updatesSupported)
  );
}

function settingsItemStatus(
  item: SettingsNavItem,
  updateActionState: SettingsSidebarProps["updateActionState"],
) {
  if (item.kind !== "action" || item.id !== "checkForUpdates") {
    return null;
  }

  if (!updateActionState.updatesSupported) {
    return "Packaged only";
  }
  if (updateActionState.isChecking) {
    return "Checking...";
  }
  if (updateActionState.hasAvailableUpdate) {
    return "Available";
  }
  return null;
}

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
    <div className={SETTINGS_SIDEBAR_ROOT_CLASS}>
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
      <div className="h-[46px] pl-[82px]" data-tauri-drag-region="true" />

      <nav className={SETTINGS_NAV_CLASS} aria-label="Settings">
        <SidebarNavRow
          icon={<ArrowLeft className="size-4" />}
          label={SETTINGS_COPY.back}
          onPress={onNavigateHome}
          className="mb-2"
        />

        <div className={SETTINGS_GROUPS_CLASS}>
          {SETTINGS_NAV_GROUPS.map((group) => (
            <div key={group.id} className={SETTINGS_GROUP_CLASS}>
              <div className={SETTINGS_GROUP_HEADING_CLASS}>
                {group.heading}
              </div>
              <div className={SETTINGS_ROW_STACK_CLASS}>
                {group.items.map((item) => {
                  const active = isSettingsItemActive(item, activeSection);
                  const disabled = isSettingsItemDisabled(
                    item,
                    disabledSections,
                    updateActionState,
                  );
                  const Icon = item.icon;
                  return (
                    <Fragment key={item.id}>
                      <SidebarNavRow
                        icon={<Icon className="size-4" />}
                        label={item.label}
                        status={settingsItemStatus(item, updateActionState)}
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
            </div>
          ))}
        </div>
      </nav>
    </div>
  );
}
