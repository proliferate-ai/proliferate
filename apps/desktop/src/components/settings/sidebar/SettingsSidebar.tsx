import { Fragment, useMemo, type ReactNode } from "react";
import {
  Archive,
  ArrowLeft,
  Blocks,
  Building2,
  Brain,
  CircleUser,
  CreditCard,
  FolderList,
  Keyboard,
  LifeBuoy,
  Palette,
  RefreshCw,
  Server,
  Settings,
  Shield,
  SlidersHorizontal,
  Tree,
} from "@proliferate/ui/icons";
import { SidebarNavRow } from "@proliferate/ui/layout/SidebarNavRow";
import { SETTINGS_COPY } from "@/copy/settings/settings-copy";
import { SHORTCUTS } from "@/config/shortcuts/registry";
import {
  SETTINGS_SHORTCUT_SECTION_ORDER,
  type SettingsSection,
} from "@/config/settings";
import {
  SETTINGS_NAV_GROUPS,
  isSettingsAdminOnlySection,
  type SettingsNavIconId,
  type SettingsNavItem,
} from "@/lib/domain/settings/navigation-presentation";
import { useAppVersion } from "@/hooks/access/tauri/app/use-app-version";
import { useSettingsSectionShortcuts } from "@/hooks/settings/ui/use-settings-section-shortcuts";
import { useShortcutRevealVisible } from "@/providers/ShortcutRevealProvider";
import { buildShortcutRangeLabelById } from "@/lib/domain/shortcuts/presentation";
import { buildSettingsShortcutSectionTargets } from "@/lib/domain/settings/shortcut-targets";
import { useOpenSupportReportWindow } from "@/hooks/support/workflows/use-open-support-report-window";
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
  "flex h-full w-[280px] shrink-0 select-none flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground";
const SETTINGS_NAV_CLASS = "flex-1 overflow-y-auto px-3 pb-5";
const SETTINGS_GROUPS_CLASS = "flex flex-col";
const SETTINGS_GROUP_CLASS = "flex flex-col gap-1";
const SETTINGS_GROUP_SPACING_CLASS = "mt-5";
const SETTINGS_GROUP_HEADING_CLASS =
  "px-2.5 pb-1 pt-1.5 text-[11px] font-medium leading-4 tracking-normal text-sidebar-muted-foreground";
const SETTINGS_ROW_INACTIVE_CLASS =
  "!text-sidebar-foreground hover:!text-sidebar-foreground";
const SETTINGS_BACK_ROW_CLASS =
  "!text-sidebar-muted-foreground hover:!text-sidebar-foreground";
const SETTINGS_ROW_ACTIVE_CLASS =
  "!font-semibold !text-sidebar-foreground";
const SETTINGS_ROW_DISABLED_CLASS =
  "!text-sidebar-muted-foreground hover:!text-sidebar-muted-foreground";

const SETTINGS_NAV_ICONS = {
  account: CircleUser,
  "agent-authentication": Shield,
  "agent-defaults": SlidersHorizontal,
  appearance: Palette,
  "archived-chats": Archive,
  billing: CreditCard,
  "check-for-updates": RefreshCw,
  compute: Server,
  environments: FolderList,
  general: Settings,
  keyboard: Keyboard,
  organization: Building2,
  "organization-integrations": Blocks,
  "organization-limits": SlidersHorizontal,
  "organization-model-policy": Brain,
  support: LifeBuoy,
  worktrees: Tree,
} satisfies Record<SettingsNavIconId, typeof Settings>;

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
  const statusItems: ReactNode[] = [];
  if (item.tbr === true) {
    statusItems.push(<TbrPill key="tbr" />);
  }

  if (item.kind === "action" && item.id === "checkForUpdates") {
    if (!updateActionState.updatesSupported) {
      statusItems.push(<span key="updates">Packaged only</span>);
    } else if (updateActionState.isChecking) {
      statusItems.push(<span key="updates">Checking...</span>);
    } else if (updateActionState.phase === "downloading") {
      statusItems.push(<span key="updates">Downloading</span>);
    } else if (updateActionState.hasAvailableUpdate) {
      statusItems.push(<span key="updates">Available</span>);
    }
  }

  return renderStatusItems(statusItems);
}

function renderStatusItems(items: ReactNode[]) {
  if (items.length === 0) {
    return null;
  }
  return <span className="flex items-center gap-1">{items}</span>;
}

function settingsItemDisabledReason(
  item: SettingsNavItem,
  disabled: boolean,
  updateActionState: SettingsSidebarProps["updateActionState"],
) {
  if (!disabled) {
    return undefined;
  }
  if (item.kind === "action" && item.id === "checkForUpdates" && !updateActionState.updatesSupported) {
    return "Desktop updates are available in packaged builds.";
  }
  return undefined;
}

function TbrPill() {
  return (
    <span
      aria-hidden="true"
      title="To be removed"
      className="rounded-md border border-sidebar-border bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none tracking-normal text-sidebar-muted-foreground"
    >
      tbr
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
  const handleOpenSupport = useOpenSupportReportWindow({ source: "settings" });
  const shortcutRevealVisible = useShortcutRevealVisible();
  const visibleNavGroups = useMemo(() =>
    SETTINGS_NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        item.kind !== "section"
        || !isSettingsAdminOnlySection(item.id)
        || adminAccess?.isAdmin === true
      ),
    })).filter((group) => group.items.length > 0),
  [adminAccess?.isAdmin]);
  const visibleShortcutSections = useMemo(() => {
    const visibleSections = new Set(
      visibleNavGroups.flatMap((group) =>
        group.items.flatMap((item) => item.kind === "section" ? [item.id] : [])
      ),
    );
    return SETTINGS_SHORTCUT_SECTION_ORDER.filter((section) =>
      visibleSections.has(section)
    );
  }, [visibleNavGroups]);
  const effectiveDisabledSections = useMemo(() => {
    return { ...disabledSections };
  }, [disabledSections]);
  const shortcutTargets = useMemo(
    () => buildSettingsShortcutSectionTargets(
      visibleShortcutSections,
      effectiveDisabledSections,
    ),
    [effectiveDisabledSections, visibleShortcutSections],
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
  function handleItemClick(item: SettingsNavItem) {
    if (isSettingsItemDisabled(item, effectiveDisabledSections, updateActionState)) {
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

      <div className="mb-5 px-3">
        <SidebarNavRow
          icon={<ArrowLeft className="size-4" />}
          label={SETTINGS_COPY.back}
          onPress={onNavigateHome}
          className={SETTINGS_BACK_ROW_CLASS}
        />
      </div>

      <nav className={SETTINGS_NAV_CLASS} aria-label="Settings">
        <div className={SETTINGS_GROUPS_CLASS}>
          {visibleNavGroups.map((group, index) => (
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
                );
                const Icon = SETTINGS_NAV_ICONS[item.iconId];
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
        <div className="shrink-0 border-t border-sidebar-border px-4 py-3 text-[11px] leading-4 text-sidebar-muted-foreground">
          Proliferate v{appVersion}
        </div>
      ) : null}
    </div>
  );
}
