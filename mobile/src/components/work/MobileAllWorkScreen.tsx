import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type {
  CloudWorkOwnerFilter,
  CloudWorkSort,
  CloudWorkStatusFilter,
  RecentWorkRuntimeLocation,
  RecentWorkSourceKind,
} from "@proliferate/product-model/workspaces/cloud-work-inventory";
import { useClaimCloudWorkspace } from "@proliferate/cloud-sdk-react";

import { useMobileWorkInventory, type MobileWorkItem } from "../../hooks/work/derived/use-mobile-work-inventory";
import { mobileIconForRuntimeLocation, mobileIconForWorkSourceKind } from "../../lib/domain/work/mobile-work-presentation";
import type { MobileCloudChat } from "../../navigation/navigation-model";
import { MobileIcon, type MobileIconName } from "../primitives/MobileIcon";
import {
  MobileEmptyState,
  MobileScreen,
} from "../primitives/MobileLayout";
import { colors, radius, spacing } from "../../styles/tokens";

interface MobileWorkspacesScreenProps {
  onOpenChat: (chat: MobileCloudChat) => void;
  onOpenDrawer: () => void;
  onNewChat: () => void;
}

type SourceFilter = RecentWorkSourceKind | "all";
type RuntimeFilter = RecentWorkRuntimeLocation | "all";
type StatusFilter = CloudWorkStatusFilter | "all";
type FilterPanel = "source" | "runtime" | "ownership" | "status" | "repo" | "sort";

const SOURCE_OPTIONS: readonly { id: SourceFilter; label: string; icon: MobileIconName }[] = [
  { id: "all", label: "All sources", icon: "workspaces" },
  { id: "cloud_sandbox", label: "Cloud", icon: "cloud" },
  { id: "desktop_exposed", label: "Desktop", icon: "monitor" },
  { id: "mobile", label: "Mobile", icon: "smartphone" },
  { id: "slack", label: "Slack", icon: "slack" },
  { id: "personal_automation", label: "Automation", icon: "calendar-clock" },
  { id: "team_automation", label: "Team automation", icon: "calendar-clock" },
  { id: "api", label: "API", icon: "cloud" },
];

const RUNTIME_OPTIONS: readonly { id: RuntimeFilter; label: string; icon: MobileIconName }[] = [
  { id: "all", label: "All runtimes", icon: "workspaces" },
  { id: "cloud_sandbox", label: "Cloud runtime", icon: "cloud" },
  { id: "local_desktop", label: "Desktop Mac", icon: "monitor" },
  { id: "ssh_remote", label: "SSH", icon: "external" },
  { id: "offline", label: "Offline", icon: "lock" },
];

const OWNER_OPTIONS: readonly { id: CloudWorkOwnerFilter; label: string }[] = [
  { id: "all", label: "All ownership" },
  { id: "private", label: "Mine" },
  { id: "unclaimed", label: "Unclaimed" },
  { id: "claimed", label: "Claimed" },
  { id: "shared", label: "Shared" },
];

const STATUS_OPTIONS: readonly { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All status" },
  { id: "active", label: "Live" },
  { id: "running", label: "Running" },
  { id: "blocked", label: "Needs input" },
  { id: "ready", label: "Ready" },
  { id: "error", label: "Error" },
  { id: "archived", label: "Archived" },
];

const SORT_OPTIONS: readonly { id: CloudWorkSort; label: string }[] = [
  { id: "recent", label: "Recent" },
  { id: "created", label: "Created" },
  { id: "name", label: "Name" },
  { id: "repo", label: "Repo" },
  { id: "status", label: "Status" },
];

export function MobileWorkspacesScreen({
  onOpenChat,
  onOpenDrawer,
  onNewChat,
}: MobileWorkspacesScreenProps) {
  const [source, setSource] = useState<SourceFilter>("all");
  const [runtime, setRuntime] = useState<RuntimeFilter>("all");
  const [ownership, setOwnership] = useState<CloudWorkOwnerFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [repo, setRepo] = useState("all");
  const [sort, setSort] = useState<CloudWorkSort>("recent");
  const [filterOpen, setFilterOpen] = useState(false);
  const [claimingWorkspaceId, setClaimingWorkspaceId] = useState<string | null>(null);
  const claimWorkspace = useClaimCloudWorkspace();
  const filters = useMemo(() => ({
    ownership,
    semanticSources: source === "all" ? undefined : new Set<RecentWorkSourceKind>([source]),
    runtimeLocations: runtime === "all" ? undefined : new Set<RecentWorkRuntimeLocation>([runtime]),
    statuses: status === "all" ? undefined : new Set<CloudWorkStatusFilter>([status]),
    repoLabels: repo === "all" ? undefined : new Set<string>([repo]),
    sort,
    needsAttention: attentionOnly,
  }), [attentionOnly, ownership, repo, runtime, sort, source, status]);
  const allInventory = useMobileWorkInventory();
  const inventory = useMobileWorkInventory(filters);
  const repoOptions = useMemo(() => {
    return [...new Set(allInventory.items.map((item) => item.view.repoLabel))]
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
  }, [allInventory.items]);
  const activeFilterCount = [
    source !== "all",
    runtime !== "all",
    ownership !== "all",
    status !== "all",
    repo !== "all",
    sort !== "recent",
    attentionOnly,
  ].filter(Boolean).length;
  const attentionCount = allInventory.items.filter((item) =>
    item.view.status === "blocked" || item.view.unclaimed
  ).length;
  const readyCount = allInventory.items.filter((item) => item.view.status === "ready").length;

  async function claimListWorkspace(item: MobileWorkItem) {
    if (!item.view.unclaimed || claimingWorkspaceId) {
      return;
    }
    setClaimingWorkspaceId(item.workspace.id);
    try {
      await claimWorkspace.mutateAsync({ workspaceId: item.workspace.id });
    } finally {
      setClaimingWorkspaceId(null);
    }
  }

  return (
    <MobileScreen
      contentStyle={styles.screenContent}
      refreshControl={
        <RefreshControl
          refreshing={inventory.isFetching && !inventory.isLoading}
          tintColor={colors.fg}
          colors={[colors.fg]}
          onRefresh={() => {
            void inventory.refetch();
          }}
        />
      }
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open navigation"
          onPress={onOpenDrawer}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <MobileIcon name="menu" size={20} color={colors.fg} />
        </Pressable>
        <Text style={styles.title}>Workspaces</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New chat"
          onPress={onNewChat}
          style={({ pressed }) => [styles.headerButton, styles.headerButtonRaised, pressed && styles.pressed]}
        >
          <MobileIcon name="plus" size={20} color={colors.fg} />
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pills}
      >
        <SummaryPill label={`All ${allInventory.items.length}`} selected={activeFilterCount === 0} onPress={() => {
          setSource("all");
          setRuntime("all");
          setOwnership("all");
          setStatus("all");
          setRepo("all");
          setSort("recent");
          setAttentionOnly(false);
        }} />
        <SummaryPill
          label={`Needs input ${attentionCount}`}
          selected={attentionOnly}
          onPress={() => {
            setAttentionOnly(!attentionOnly);
            setStatus("all");
            setOwnership("all");
          }}
        />
        <SummaryPill
          label={`Ready ${readyCount}`}
          selected={status === "ready" && !attentionOnly}
          onPress={() => {
            setAttentionOnly(false);
            setStatus(status === "ready" ? "all" : "ready");
          }}
        />
        <SummaryPill
          label={activeFilterCount ? `Filters ${activeFilterCount}` : "Filter"}
          icon="filter"
          selected={activeFilterCount > 0}
          onPress={() => setFilterOpen(true)}
        />
      </ScrollView>

      {inventory.error && inventory.items.length > 0 ? (
        <View style={styles.partialWarning}>
          <MobileIcon name="cloud" size={13} color={colors.warning} />
          <Text style={styles.partialWarningText}>
            Some workspaces could not refresh. Showing the workspaces that loaded.
          </Text>
        </View>
      ) : null}

      {inventory.isLoading ? (
        <MobileEmptyState title="Loading workspaces" body="Fetching visible cloud workspaces." />
      ) : inventory.error && inventory.items.length === 0 ? (
        <MobileEmptyState title="Could not load workspaces" body="Pull to refresh or sign in again." />
      ) : inventory.items.length === 0 ? (
        <MobileEmptyState
          title="No matching workspaces"
          body="Adjust filters or start a new chat."
        />
      ) : (
        <View style={styles.groups}>
          {inventory.groups.map((group) => (
            <View key={group.view.id} style={styles.group}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{group.view.label}</Text>
              </View>
              <View style={styles.cards}>
                {group.items.map((item) => (
                  <WorkspaceCard
                    key={item.view.id}
                    item={item}
                    claiming={claimingWorkspaceId === item.workspace.id}
                    onPress={() => onOpenChat(item.chat)}
                    onClaim={() => {
                      void claimListWorkspace(item);
                    }}
                  />
                ))}
              </View>
            </View>
          ))}
        </View>
      )}

      <FilterSheet
        visible={filterOpen}
        source={source}
        runtime={runtime}
        ownership={ownership}
        status={status}
        repo={repo}
        sort={sort}
        repoOptions={repoOptions}
        onSource={setSource}
        onRuntime={setRuntime}
        onOwnership={(value) => {
          setAttentionOnly(false);
          setOwnership(value);
        }}
        onStatus={(value) => {
          setAttentionOnly(false);
          setStatus(value);
        }}
        onRepo={setRepo}
        onSort={setSort}
        onClear={() => {
          setSource("all");
          setRuntime("all");
          setOwnership("all");
          setStatus("all");
          setRepo("all");
          setSort("recent");
          setAttentionOnly(false);
        }}
        onClose={() => setFilterOpen(false)}
      />
    </MobileScreen>
  );
}

function SummaryPill({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon?: MobileIconName;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.summaryPill,
        selected && styles.summaryPillSelected,
        pressed && styles.pressed,
      ]}
    >
      {icon ? <MobileIcon name={icon} size={14} color={selected ? colors.fg : colors.faint} /> : null}
      <Text style={[styles.summaryPillText, selected && styles.summaryPillTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

function WorkspaceCard({
  item,
  claiming,
  onPress,
  onClaim,
}: {
  item: MobileWorkItem;
  claiming: boolean;
  onPress: () => void;
  onClaim: () => void;
}) {
  const detailText = workspaceDetailText(item);
  const blocked = item.view.status === "blocked" || item.view.status === "error";
  const active = item.view.status === "active" || item.view.status === "running";
  const unclaimed = item.view.unclaimed;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.cardTop}>
        <View style={styles.iconTile}>
          <MobileIcon
            name={mobileIconForWorkSourceKind(item.view.sourceKind)}
            size={21}
            color={item.view.sourceKind === "slack" ? colors.success : colors.fg}
          />
          <View
            style={[
              styles.stateDot,
              active && styles.stateDotActive,
              blocked && styles.stateDotBlocked,
              unclaimed && styles.stateDotUnclaimed,
            ]}
          />
        </View>
        <View style={styles.cardTitleBlock}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle} numberOfLines={1}>{item.view.title}</Text>
            <Text style={styles.cardTime}>{item.view.lastActivityLabel}</Text>
          </View>
          <View style={styles.cardMetaRow}>
            <MobileIcon
              name={mobileIconForRuntimeLocation(item.view.runtimeLocation)}
              size={13}
              color={colors.faint}
            />
            <Text style={styles.cardMeta} numberOfLines={1}>
              {item.view.repoLabel} · {item.view.branchLabel}
            </Text>
          </View>
        </View>
      </View>
      {detailText ? (
        <View style={styles.promptBlock}>
          <Text style={styles.promptText} numberOfLines={2}>
            {detailText}
          </Text>
        </View>
      ) : null}
      {unclaimed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Claim workspace"
          accessibilityState={{ disabled: claiming }}
          disabled={claiming}
          onPress={onClaim}
          style={({ pressed }) => [
            styles.claimButton,
            claiming && styles.claimButtonDisabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.claimButtonText}>{claiming ? "Claiming" : "Claim workspace"}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function workspaceDetailText(item: MobileWorkItem): string | null {
  if (item.view.unclaimed) {
    return "Unclaimed workspace";
  }
  if (item.view.status === "blocked" || item.view.status === "error") {
    return item.view.statusLabel;
  }
  if (item.view.commandability !== "commandable") {
    return item.view.commandabilityLabel;
  }
  return null;
}

function FilterSheet({
  visible,
  source,
  runtime,
  ownership,
  status,
  repo,
  sort,
  repoOptions,
  onSource,
  onRuntime,
  onOwnership,
  onStatus,
  onRepo,
  onSort,
  onClear,
  onClose,
}: {
  visible: boolean;
  source: SourceFilter;
  runtime: RuntimeFilter;
  ownership: CloudWorkOwnerFilter;
  status: StatusFilter;
  repo: string;
  sort: CloudWorkSort;
  repoOptions: readonly string[];
  onSource: (value: SourceFilter) => void;
  onRuntime: (value: RuntimeFilter) => void;
  onOwnership: (value: CloudWorkOwnerFilter) => void;
  onStatus: (value: StatusFilter) => void;
  onRepo: (value: string) => void;
  onSort: (value: CloudWorkSort) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [panel, setPanel] = useState<FilterPanel | null>(null);

  useEffect(() => {
    if (!visible) {
      setPanel(null);
    }
  }, [visible]);

  const panelTitle = panel ? filterPanelTitle(panel) : "Filter workspaces";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.sheetLayer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close filters"
          style={styles.sheetScrim}
          onPress={onClose}
        />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            {panel ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to filters"
                onPress={() => setPanel(null)}
                style={({ pressed }) => [styles.sheetHeaderIcon, pressed && styles.pressed]}
              >
                <MobileIcon name="chevron-left" size={18} color={colors.fg} />
              </Pressable>
            ) : (
              <View style={styles.sheetHeaderIcon} />
            )}
            <View style={styles.sheetTitleArea}>
              <Text style={styles.sheetTitle}>{panelTitle}</Text>
              {!panel ? <Text style={styles.sheetSubtitle}>Choose what to show and how to sort it.</Text> : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear filters"
              onPress={onClear}
              style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
            >
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetScrollContent}>
            {!panel ? (
              <>
                <FilterSummaryRow
                  icon="workspaces"
                  title="Source"
                  value={optionLabel(SOURCE_OPTIONS, source)}
                  onPress={() => setPanel("source")}
                />
                <FilterSummaryRow
                  icon="cloud"
                  title="Runtime"
                  value={optionLabel(RUNTIME_OPTIONS, runtime)}
                  onPress={() => setPanel("runtime")}
                />
                <FilterSummaryRow
                  icon="users"
                  title="Ownership"
                  value={optionLabel(OWNER_OPTIONS, ownership)}
                  onPress={() => setPanel("ownership")}
                />
                <FilterSummaryRow
                  icon="filter"
                  title="Status"
                  value={optionLabel(STATUS_OPTIONS, status)}
                  onPress={() => setPanel("status")}
                />
                <FilterSummaryRow
                  icon="folder"
                  title="Repo"
                  value={repo === "all" ? "All repos" : repo}
                  onPress={() => setPanel("repo")}
                />
                <FilterSummaryRow
                  icon="controls"
                  title="Sort"
                  value={optionLabel(SORT_OPTIONS, sort)}
                  onPress={() => setPanel("sort")}
                />
              </>
            ) : null}
            {panel === "source" ? SOURCE_OPTIONS.map((option) => (
                <FilterChoice
                  key={option.id}
                  label={option.label}
                  icon={option.icon}
                  selected={source === option.id}
                  onPress={() => onSource(option.id)}
                />
              )) : null}
            {panel === "runtime" ? RUNTIME_OPTIONS.map((option) => (
                <FilterChoice
                  key={option.id}
                  label={option.label}
                  icon={option.icon}
                  selected={runtime === option.id}
                  onPress={() => onRuntime(option.id)}
                />
              )) : null}
            {panel === "ownership" ? OWNER_OPTIONS.map((option) => (
                <FilterChoice
                  key={option.id}
                  label={option.label}
                  selected={ownership === option.id}
                  onPress={() => onOwnership(option.id)}
                />
              )) : null}
            {panel === "status" ? STATUS_OPTIONS.map((option) => (
                <FilterChoice
                  key={option.id}
                  label={option.label}
                  selected={status === option.id}
                  onPress={() => onStatus(option.id)}
                />
              )) : null}
            {panel === "repo" ? (
              <>
                <FilterChoice
                  label="All repos"
                  selected={repo === "all"}
                  onPress={() => onRepo("all")}
                />
                {repoOptions.map((option) => (
                  <FilterChoice
                    key={option}
                    label={option}
                    icon="folder"
                    selected={repo === option}
                    onPress={() => onRepo(option)}
                  />
                ))}
              </>
            ) : null}
            {panel === "sort" ? SORT_OPTIONS.map((option) => (
                <FilterChoice
                  key={option.id}
                  label={option.label}
                  selected={sort === option.id}
                  onPress={() => onSort(option.id)}
                />
              )) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function FilterSummaryRow({
  icon,
  title,
  value,
  onPress,
}: {
  icon: MobileIconName;
  title: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.filterSummaryRow, pressed && styles.pressed]}
    >
      <View style={styles.filterSummaryIcon}>
        <MobileIcon name={icon} size={17} color={colors.fg} />
      </View>
      <View style={styles.filterSummaryText}>
        <Text style={styles.filterSummaryTitle}>{title}</Text>
        <Text style={styles.filterSummaryValue} numberOfLines={1}>{value}</Text>
      </View>
      <MobileIcon name="chevron-right" size={17} color={colors.faint} />
    </Pressable>
  );
}

function filterPanelTitle(panel: FilterPanel): string {
  switch (panel) {
    case "source":
      return "Source";
    case "runtime":
      return "Runtime";
    case "ownership":
      return "Ownership";
    case "status":
      return "Status";
    case "repo":
      return "Repo";
    case "sort":
      return "Sort";
  }
}

function optionLabel<T extends string>(
  options: readonly { id: T; label: string }[],
  value: T,
): string {
  return options.find((option) => option.id === value)?.label ?? value;
}

function FilterChoice({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon?: MobileIconName;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        selected && styles.choiceSelected,
        pressed && styles.pressed,
      ]}
    >
      {icon ? <MobileIcon name={icon} size={14} color={selected ? colors.fg : colors.faint} /> : null}
      <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
      {selected ? <MobileIcon name="check" size={15} color={colors.fg} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  header: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[4],
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  headerButtonRaised: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  title: {
    color: colors.fg,
    fontSize: 16,
    fontWeight: "600",
  },
  pills: {
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[4],
  },
  summaryPill: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[3],
  },
  summaryPillSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.borderHeavy,
  },
  summaryPillText: {
    color: colors.faint,
    fontSize: 14,
    fontWeight: "600",
  },
  summaryPillTextSelected: {
    color: colors.fg,
  },
  groups: {
    gap: spacing[6],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[8],
  },
  partialWarning: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    marginHorizontal: spacing[4],
    marginTop: spacing[2],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.warningSubtle,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  partialWarningText: {
    flex: 1,
    color: colors.warning,
    fontSize: 12,
    lineHeight: 16,
  },
  group: {
    gap: spacing[3],
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: colors.faint,
    fontSize: 13,
    fontWeight: "500",
  },
  cards: {
    gap: spacing[2],
  },
  card: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    gap: spacing[3],
  },
  cardPressed: {
    opacity: 0.82,
    backgroundColor: colors.accent,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  iconTile: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  stateDot: {
    position: "absolute",
    right: 4,
    bottom: 4,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.borderHeavy,
  },
  stateDotActive: {
    backgroundColor: colors.info,
  },
  stateDotBlocked: {
    backgroundColor: colors.destructive,
  },
  stateDotUnclaimed: {
    backgroundColor: colors.success,
  },
  cardTitleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  cardTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.fg,
    fontSize: 16,
    fontWeight: "600",
  },
  cardTime: {
    color: colors.faint,
    fontSize: 12,
    fontWeight: "500",
  },
  cardMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  cardMeta: {
    flex: 1,
    minWidth: 0,
    color: colors.faint,
    fontSize: 13.5,
    lineHeight: 18,
  },
  promptBlock: {
    borderRadius: 18,
    backgroundColor: colors.background,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  promptText: {
    color: colors.mutedForeground,
    fontSize: 13,
    lineHeight: 18,
  },
  claimButton: {
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.fg,
    paddingHorizontal: spacing[4],
  },
  claimButtonDisabled: {
    opacity: 0.62,
  },
  claimButtonText: {
    color: colors.background,
    fontSize: 13,
    fontWeight: "600",
  },
  sheetLayer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlayStrong,
  },
  sheet: {
    maxHeight: "84%",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
    paddingBottom: spacing[6],
    gap: spacing[4],
  },
  sheetScroll: {
    minHeight: 0,
  },
  sheetScrollContent: {
    gap: spacing[4],
    paddingBottom: spacing[1],
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
  },
  sheetHeaderIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  sheetTitleArea: {
    flex: 1,
    minWidth: 0,
  },
  sheetTitle: {
    color: colors.fg,
    fontSize: 17,
    fontWeight: "600",
  },
  sheetSubtitle: {
    color: colors.faint,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  clearButton: {
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  clearText: {
    color: colors.faint,
    fontSize: 13,
    fontWeight: "600",
  },
  filterSummaryRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: 18,
    paddingHorizontal: spacing[3],
  },
  filterSummaryIcon: {
    width: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  filterSummaryText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  filterSummaryTitle: {
    color: colors.fg,
    fontSize: 16,
    fontWeight: "600",
  },
  filterSummaryValue: {
    color: colors.faint,
    fontSize: 13,
    lineHeight: 17,
  },
  choice: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: 16,
    paddingHorizontal: spacing[3],
  },
  choiceSelected: {
    backgroundColor: colors.accent,
  },
  choiceText: {
    flex: 1,
    minWidth: 0,
    color: colors.faint,
    fontSize: 15,
    fontWeight: "600",
  },
  choiceTextSelected: {
    color: colors.fg,
  },
  pressed: {
    opacity: 0.7,
  },
});
