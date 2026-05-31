import { Fragment, useCallback, useEffect, useMemo } from "react";
import { ArrowLeft } from "@proliferate/ui/icons";
import { SidebarNavRow } from "@proliferate/ui/layout/SidebarNavRow";
import { SETTINGS_COPY } from "@/copy/settings/settings-copy";
import { SHORTCUTS } from "@/config/shortcuts";
import {
  SETTINGS_SHORTCUT_SECTION_ORDER,
  type SettingsSection,
} from "@/config/settings";
import {
  SETTINGS_NAV_GROUPS,
  type SettingsNavItem,
} from "@/components/settings/settings-navigation";
import { useAppVersion } from "@/hooks/access/tauri/app/use-app-version";
import { useSettingsSectionShortcuts } from "@/hooks/settings/ui/use-settings-section-shortcuts";
import { useShortcutRevealVisible } from "@/providers/ShortcutRevealProvider";
import { buildShortcutRangeLabelById } from "@/lib/domain/shortcuts/presentation";
import { buildSettingsShortcutSectionTargets } from "@/lib/domain/settings/shortcut-targets";
import { openSupportReportWindow } from "@/lib/access/tauri/support";
import { subscribeSupportDialogRequest } from "@/lib/infra/support/support-dialog-request";
import { useSupportReportSnapshot } from "@/hooks/support/derived/use-support-report-snapshot";
import { useToastStore } from "@/stores/toast/toast-store";
import type { UpdaterPhase } from "@/hooks/access/tauri/use-updater";

interface SettingsSidebarProps {
  activeSection: SettingsSection;
  adminAccess?: {
    isAdmin: boolean;
    isLoading?: boolean;
  };
  disabledSections?: Partial<Record<SettingsSection, boolean>>;
  onNavigateHome: () => void;
  onSelectSection: (section: SettingsSection) => void;
  onCheckForUpdates: () => void;
  updateActionState: {
    isChecking: boolean;
    hasAvailableUpdate: boolean;
    phase: UpdaterPhase;
    updatesSupported: boolean;
  };
}

const SETTINGS_SIDEBAR_ROOT_CLASS =
  "flex h-full w-[280px] shrink-0 select-none flex-col border-r border-sidebar-border bg-sidebar";
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
  adminAccess: SettingsSidebarProps["adminAccess"],
) {
  return (
    (item.kind === "section" && !!disabledSections?.[item.id])
    || (item.kind === "section" && item.adminOnly === true && adminAccess?.isAdmin !== true)
    || (item.kind === "action"
      && item.id === "checkForUpdates"
      && !updateActionState.updatesSupported)
  );
}

function settingsItemStatus(
  item: SettingsNavItem,
  updateActionState: SettingsSidebarProps["updateActionState"],
) {
  if (item.kind === "section" && item.adminOnly === true) {
    return <AdminPill />;
  }
  if (item.kind !== "action" || item.id !== "checkForUpdates") {
    return null;
  }

  if (!updateActionState.updatesSupported) {
    return "Packaged only";
  }
  if (updateActionState.isChecking) {
    return "Checking...";
  }
  if (updateActionState.phase === "downloading") {
    return "Downloading";
  }
  if (updateActionState.hasAvailableUpdate) {
    return "Available";
  }
  return null;
}

function settingsItemDisabledReason(
  item: SettingsNavItem,
  disabled: boolean,
  updateActionState: SettingsSidebarProps["updateActionState"],
  adminAccess: SettingsSidebarProps["adminAccess"],
) {
  if (!disabled) {
    return undefined;
  }
  if (item.kind === "section" && item.adminOnly === true && adminAccess?.isAdmin !== true) {
    return adminAccess?.isLoading ? "Checking admin access" : "Admin access required";
  }
  if (item.kind === "action" && item.id === "checkForUpdates" && !updateActionState.updatesSupported) {
    return "Desktop updates are available in packaged builds.";
  }
  return undefined;
}

function AdminPill() {
  return (
    <span className="rounded-sm border border-sidebar-border px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-normal text-sidebar-muted-foreground">
      Admin
    </span>
  );
}

export function SettingsSidebar({
  activeSection,
  adminAccess,
  disabledSections,
  onNavigateHome,
  onSelectSection,
  onCheckForUpdates,
  updateActionState,
}: SettingsSidebarProps) {
  const appVersion = useAppVersion().data?.trim();
  const supportSnapshot = useSupportReportSnapshot({ source: "settings" });
  const showToast = useToastStore((state) => state.show);
  const shortcutRevealVisible = useShortcutRevealVisible();
  const effectiveDisabledSections = useMemo(() => {
    const next: Partial<Record<SettingsSection, boolean>> = { ...disabledSections };
    for (const group of SETTINGS_NAV_GROUPS) {
      for (const item of group.items) {
        if (item.kind === "section" && item.adminOnly === true && adminAccess?.isAdmin !== true) {
          next[item.id] = true;
        }
      }
    }
    return next;
  }, [adminAccess?.isAdmin, disabledSections]);
  const shortcutTargets = useMemo(
    () => buildSettingsShortcutSectionTargets(
      SETTINGS_SHORTCUT_SECTION_ORDER,
      effectiveDisabledSections,
    ),
    [effectiveDisabledSections],
  );
  const shortcutLabelBySection = useMemo(
    () => buildShortcutRangeLabelById(
      shortcutTargets.map((target) => target.section),
      SHORTCUTS.settingsSectionByIndex,
    ),
    [shortcutTargets],
  );
  useSettingsSectionShortcuts({
    targets: shortcutTargets,
    onSelectSection,
  });
  const handleOpenSupport = useCallback(() => {
    void openSupportReportWindow(supportSnapshot).catch((error) => {
      const message = error instanceof Error ? error.message : "Failed to open support.";
      showToast(message);
    });
  }, [showToast, supportSnapshot]);
  useEffect(() => subscribeSupportDialogRequest(handleOpenSupport), [handleOpenSupport]);

  function handleItemClick(item: SettingsNavItem) {
    if (isSettingsItemDisabled(item, effectiveDisabledSections, updateActionState, adminAccess)) {
      return;
    }

    if (item.kind === "action") {
      if (item.id === "support") {
        handleOpenSupport();
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

  return (
    <div className={SETTINGS_SIDEBAR_ROOT_CLASS}>
      <div className="h-10 pl-[82px]" data-tauri-drag-region="true" />

      <div className="mb-4 px-2.5">
        <SidebarNavRow
          icon={<ArrowLeft className="size-4" />}
          label={SETTINGS_COPY.back}
          onPress={onNavigateHome}
          className={SETTINGS_BACK_ROW_CLASS}
        />
      </div>

      <nav className={SETTINGS_NAV_CLASS} aria-label="Settings">
        <div className={SETTINGS_GROUPS_CLASS}>
          {SETTINGS_NAV_GROUPS.map((group, index) => (
            <div
              key={group.id}
              className={`${SETTINGS_GROUP_CLASS} ${index > 0 ? SETTINGS_GROUP_SPACING_CLASS : ""}`}
            >
              {group.heading ? (
                <div className={SETTINGS_GROUP_HEADING_CLASS}>
                  {group.heading}
                </div>
              ) : null}
              {group.items.map((item) => {
                const active = isSettingsItemActive(item, activeSection);
                const disabled = isSettingsItemDisabled(
                  item,
                  effectiveDisabledSections,
                  updateActionState,
                  adminAccess,
                );
                const Icon = item.icon;
                return (
                  <Fragment key={item.id}>
                    <SidebarNavRow
                      icon={<Icon className="size-4" />}
                      label={item.label}
                      status={settingsItemStatus(item, updateActionState)}
                      shortcutLabel={
                        item.kind === "section"
                          ? shortcutLabelBySection.get(item.id)
                          : undefined
                      }
                      title={settingsItemDisabledReason(
                        item,
                        disabled,
                        updateActionState,
                        adminAccess,
                      )}
                      onPress={() => handleItemClick(item)}
                      active={active}
                      disabled={disabled}
                      aria-current={active ? "page" : undefined}
                      className={settingsRowClass(active, disabled)}
                      shortcutRevealVisible={shortcutRevealVisible}
                    />
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
