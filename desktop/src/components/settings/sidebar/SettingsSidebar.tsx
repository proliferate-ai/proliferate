import { Fragment, useEffect, useState } from "react";
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
import { subscribeSupportDialogRequest } from "@/lib/infra/support/support-dialog-request";
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
  "flex h-full w-[300px] shrink-0 select-none flex-col border-r border-sidebar-border bg-sidebar-background";
const SETTINGS_NAV_CLASS = "flex-1 overflow-y-auto px-2.5 pb-4";
const SETTINGS_GROUPS_CLASS = "flex flex-col";
const SETTINGS_GROUP_CLASS = "flex flex-col gap-0.5";
const SETTINGS_GROUP_SPACING_CLASS = "mt-4";
const SETTINGS_GROUP_HEADING_CLASS =
  "px-2 pb-1 pt-1.5 text-[11px] font-medium leading-4 tracking-normal text-sidebar-muted-foreground";
const SETTINGS_ROW_INACTIVE_CLASS =
  "!text-sidebar-foreground hover:!text-sidebar-foreground";
const SETTINGS_BACK_ROW_CLASS =
  "!text-sidebar-muted-foreground hover:!text-sidebar-foreground";
const SETTINGS_ROW_ACTIVE_CLASS =
  "!font-medium !text-sidebar-foreground";
const SETTINGS_ROW_DISABLED_CLASS =
  "!text-sidebar-muted-foreground hover:!text-sidebar-muted-foreground";

function settingsRowClass(active: boolean, disabled = false) {
  return [
    active ? SETTINGS_ROW_ACTIVE_CLASS : SETTINGS_ROW_INACTIVE_CLASS,
    disabled ? SETTINGS_ROW_DISABLED_CLASS : "",
  ].filter(Boolean).join(" ");
}

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
  const appVersion = useAppVersion().data?.trim();
  useEffect(() => subscribeSupportDialogRequest(() => setSupportOpen(true)), []);

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
        className={settingsRowClass(false, disabled)}
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
      <div className="h-10 pl-[82px]" data-tauri-drag-region="true" />

      <div className="mb-4 px-2.5">
        <SidebarNavRow
          icon={<ArrowLeft className="size-4" />}
          label={SETTINGS_COPY.back}
          onPress={onNavigateHome}
          className={`w-fit ${SETTINGS_BACK_ROW_CLASS}`}
        />
      </div>

      <nav className={SETTINGS_NAV_CLASS} aria-label="Settings">
        <div className={SETTINGS_GROUPS_CLASS}>
          {SETTINGS_NAV_GROUPS.map((group, index) => (
            <div
              key={group.id}
              className={`${SETTINGS_GROUP_CLASS} ${index > 0 ? SETTINGS_GROUP_SPACING_CLASS : ""}`}
            >
              <div className={SETTINGS_GROUP_HEADING_CLASS}>
                {group.heading}
              </div>
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
                      className={settingsRowClass(active, disabled)}
                    />
                    {item.kind === "action" && item.id === "checkForUpdates"
                      ? renderUpdateCommand()
                      : null}
                  </Fragment>
                );
              })}
            </div>
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
