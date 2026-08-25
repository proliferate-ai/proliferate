import { Fragment, useMemo, type ComponentType, type ReactNode } from "react";
import {
  Archive,
  KeyRound,
  LifeBuoy,
  Palette,
  SlidersHorizontal,
} from "#product/primitives/icons/core";
import {
  Blocks,
  Building2,
  CircleUser,
  CreditCard,
  Gauge,
  MousePointerClick,
  RefreshCw,
  Settings2,
  Users,
} from "#product/primitives/icons/platform";
import { Brain } from "#product/primitives/icons/product";
import { SidebarNavRow } from "#product/primitives/patterns/sidebar/SidebarNavRow";
import { ProviderIcon } from "#product/primitives/icons/provider-icons";
import { SidebarAccountFooter } from "#product/components/app/sidebar/SidebarAccountFooter";
import { StatusDot } from "#product/primitives/StatusDot";
import { SHORTCUTS } from "#product/config/shortcuts/registry";
import {
  TEMPORARILY_SHOW_ADMIN_SETTINGS_FOR_UI_ITERATION,
  type SettingsSection,
} from "#product/config/settings";
import {
  SETTINGS_HELP_ITEMS,
  getHarnessKindForSettingsSection,
  getSettingsScopeNav,
  isSettingsAdminOnlySection,
  isSettingsHarnessSection,
  type SettingsNavIconId,
  type SettingsNavItem,
  type SettingsScope,
} from "#product/lib/domain/settings/navigation-presentation";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import { getHarnessAttentionDotTone } from "#product/lib/domain/agents/status-presentation";
import { useAppVersion } from "#product/hooks/access/tauri/app/use-app-version";
import { useSettingsSectionShortcuts } from "#product/hooks/settings/ui/use-settings-section-shortcuts";
import { useShortcutRevealVisible } from "#product/providers/ShortcutRevealProvider";
import { buildShortcutRangeLabelById } from "#product/lib/domain/shortcuts/presentation";
import { buildSettingsShortcutSectionTargets } from "#product/lib/domain/settings/shortcut-targets";
import { useOpenSupportReportWindow } from "#product/hooks/support/workflows/use-open-support-report-window";
import type { UpdaterPhase } from "#product/hooks/access/tauri/use-updater";

interface SettingsSidebarProps {
  activeScope: SettingsScope;
  activeSection: SettingsSection;
  adminAccess?: {
    isAdmin: boolean;
    isLoading?: boolean;
  };
  disabledSections?: Partial<Record<SettingsSection, boolean>>;
  onSelectSection: (section: SettingsSection) => void;
  onCheckForUpdates: () => void;
  updateActionState: {
    phase: UpdaterPhase;
    updatesSupported: boolean;
  };
}

const SETTINGS_SIDEBAR_ROOT_CLASS =
  "flex h-full w-full select-none flex-col bg-background text-foreground";
const SETTINGS_NAV_CLASS = "flex-1 overflow-y-auto px-3 pb-5 pt-4";
const SETTINGS_GROUPS_CLASS = "flex flex-col";
const SETTINGS_GROUP_CLASS = "flex flex-col gap-0.5";
const SETTINGS_GROUP_SPACING_CLASS = "mt-6";
const SETTINGS_GROUP_HEADING_SPACING_CLASS = "px-2.5 pb-1.5";

/** Brand glyph for a per-harness nav entry, adapted to the icon-map contract. */
function harnessNavIcon(kind: string) {
  return function HarnessNavIcon({ className }: { className?: string }) {
    return <ProviderIcon kind={kind} className={className} />;
  };
}

const SETTINGS_NAV_ICONS = {
  account: CircleUser,
  "agent-api-keys": KeyRound,
  "agent-claude": harnessNavIcon("claude"),
  "agent-codex": harnessNavIcon("codex"),
  "agent-cursor": harnessNavIcon("cursor"),
  "agent-grok": harnessNavIcon("grok"),
  "agent-opencode": harnessNavIcon("opencode"),
  appearance: Palette,
  "archived-workspaces": Archive,
  billing: CreditCard,
  "check-for-updates": RefreshCw,
  environments: SlidersHorizontal,
  general: Settings2,
  integrations: Blocks,
  organization: Building2,
  "organization-integrations": Blocks,
  "organization-limits": Gauge,
  "organization-members": Users,
  "organization-model-policy": Brain,
  "organization-secrets": KeyRound,
  "personal-secrets": KeyRound,
  "repo-actions": MousePointerClick,
  "repo-environment": KeyRound,
  support: LifeBuoy,
} satisfies Record<SettingsNavIconId, ComponentType<{ className?: string }>>;

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
  agentsByKind: Map<string, any>,
) {
  const statusItems: ReactNode[] = [];

  if (item.kind === "section" && isSettingsHarnessSection(item.id)) {
    const harnessKind = getHarnessKindForSettingsSection(item.id);
    const agent = agentsByKind.get(harnessKind);
    const attentionTone = getHarnessAttentionDotTone(agent);
    if (attentionTone) {
      statusItems.push(<StatusDot key="harness-status" tone={attentionTone} />);
    }
  }

  if (item.kind === "action" && item.id === "checkForUpdates") {
    if (!updateActionState.updatesSupported) {
      statusItems.push(<span key="updates">Packaged app only</span>);
    } else if (updateActionState.phase === "checking") {
      statusItems.push(<span key="updates">Checking…</span>);
    } else if (updateActionState.phase === "downloading") {
      statusItems.push(<span key="updates">Downloading</span>);
    } else if (updateActionState.phase === "available") {
      statusItems.push(<span key="updates">Available</span>);
    } else if (updateActionState.phase === "ready") {
      statusItems.push(<span key="updates">Restart to update</span>);
    } else if (updateActionState.phase === "stalled") {
      statusItems.push(<span key="updates">Stalled</span>);
    } else if (updateActionState.phase === "error") {
      // The row is where the user came to check, so it must not read as
      // "nothing happened" after a failure.
      statusItems.push(<span key="updates">Couldn't check</span>);
    } else if (updateActionState.phase === "current") {
      statusItems.push(<span key="updates">Up to date</span>);
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
    return "Updates only work in the packaged app.";
  }
  return undefined;
}

export function SettingsSidebar({
  activeScope,
  activeSection,
  adminAccess,
  disabledSections,
  onSelectSection,
  onCheckForUpdates,
  updateActionState,
}: SettingsSidebarProps) {
  const appVersion = useAppVersion().data?.trim();
  const { openBug: handleOpenSupport } = useOpenSupportReportWindow({ source: "settings" });
  const shortcutRevealVisible = useShortcutRevealVisible();
  const { agentsByKind } = useAgentCatalog();
  const visibleNavGroups = useMemo(() =>
    getSettingsScopeNav(activeScope).groups.map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        item.kind !== "section"
        || !isSettingsAdminOnlySection(item.id)
        || TEMPORARILY_SHOW_ADMIN_SETTINGS_FOR_UI_ITERATION
        || adminAccess?.isAdmin === true
      ),
    })).filter((group) => group.items.length > 0),
  [activeScope, adminAccess?.isAdmin]);
  const visibleShortcutSections = useMemo(() => {
    return visibleNavGroups.flatMap((group) =>
      group.items.flatMap((item) =>
        item.kind === "section" ? [item.id] : []
      )
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

  function renderNavRow(item: SettingsNavItem) {
    const active = isSettingsItemActive(item, activeSection);
    const disabled = isSettingsItemDisabled(item, effectiveDisabledSections, updateActionState);
    const Icon = SETTINGS_NAV_ICONS[item.iconId];
    return (
      <SidebarNavRow
        key={item.id}
        icon={<Icon className="icon-paired" />}
        label={item.label}
        status={settingsItemStatus(item, updateActionState, agentsByKind)}
        shortcutLabel={item.kind === "section" ? shortcutLabelBySection.get(item.id) : undefined}
        title={settingsItemDisabledReason(item, disabled, updateActionState)}
        onPress={() => handleItemClick(item)}
        active={active}
        disabled={disabled}
        aria-current={active ? "page" : undefined}
        shortcutRevealVisible={shortcutRevealVisible}
      />
    );
  }

  return (
    <div className={SETTINGS_SIDEBAR_ROOT_CLASS}>
      <nav className={SETTINGS_NAV_CLASS} aria-label="Settings">
        <div className={SETTINGS_GROUPS_CLASS}>
          {visibleNavGroups.map((group, index) => (
            <div
              key={group.id}
              className={`${SETTINGS_GROUP_CLASS} ${index > 0 ? SETTINGS_GROUP_SPACING_CLASS : ""}`}
            >
              {group.heading ? (
                <div className={`text-ui-sm text-muted-foreground ${SETTINGS_GROUP_HEADING_SPACING_CLASS}`}>
                  {group.heading}
                </div>
              ) : null}
              {group.items.map((item) => (
                <Fragment key={item.id}>{renderNavRow(item)}</Fragment>
              ))}
            </div>
          ))}

          <div className={`${SETTINGS_GROUP_CLASS} ${SETTINGS_GROUP_SPACING_CLASS}`}>
            {SETTINGS_HELP_ITEMS.map((item) => (
              <Fragment key={item.id}>{renderNavRow(item)}</Fragment>
            ))}
            {appVersion ? (
              <div className="px-2.5 py-2 text-ui-sm text-muted-foreground">
                Proliferate v{appVersion}
              </div>
            ) : null}
          </div>
        </div>
      </nav>
      <SidebarAccountFooter />
    </div>
  );
}
