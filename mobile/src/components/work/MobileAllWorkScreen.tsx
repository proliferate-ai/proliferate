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
import type { MobileCloudChat } from "../../navigation/navigation-model";
import { MobileIcon, type MobileIconName } from "../primitives/MobileIcon";
import {
  MobileEmptyState,
  MobileScreen,
} from "../primitives/MobileLayout";
import { MobileWorkspaceCard } from "./MobileWorkspaceCard";
import { colors, radius, spacing } from "../../styles/tokens";

interface MobileWorkspacesScreenProps {
  onOpenChat: (chat: MobileCloudChat) => void;
  onOpenDrawer: () => void;
  onNewChat: () => void;
}

type AgentFilter = "all" | "claude" | "codex" | "opencode" | "gemini";
type WorkTypeFilter = "all" | "cloud" | "slack" | "personal_automation" | "team_automation" | "dispatch";
type RuntimeFilter = RecentWorkRuntimeLocation | "all";
type StatusFilter = CloudWorkStatusFilter | "all";
type FilterPanel = "type" | "runtime" | "ownership" | "status" | "repo" | "sort";

const AGENT_OPTIONS: readonly { id: AgentFilter; label: string; icon: MobileIconName }[] = [
  { id: "all", label: "All", icon: "sparkles" },
  { id: "claude", label: "Claude", icon: "claude" },
  { id: "codex", label: "Codex", icon: "openai" },
  { id: "opencode", label: "OpenCode", icon: "sparkles" },
  { id: "gemini", label: "Gemini", icon: "gemini" },
];

const WORK_TYPE_OPTIONS: readonly { id: WorkTypeFilter; label: string; icon: MobileIconName }[] = [
  { id: "all", label: "All", icon: "workspaces" },
  { id: "cloud", label: "Cloud", icon: "cloud" },
  { id: "slack", label: "Slack", icon: "slack" },
  { id: "personal_automation", label: "Automation", icon: "calendar-clock" },
  { id: "team_automation", label: "Team automation", icon: "calendar-clock" },
  { id: "dispatch", label: "Dispatch", icon: "monitor" },
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
  const [agent, setAgent] = useState<AgentFilter>("all");
  const [workType, setWorkType] = useState<WorkTypeFilter>("all");
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
    semanticSources: semanticSourcesForWorkType(workType),
    runtimeLocations: runtime === "all" ? undefined : new Set<RecentWorkRuntimeLocation>([runtime]),
    statuses: status === "all" ? undefined : new Set<CloudWorkStatusFilter>([status]),
    repoLabels: repo === "all" ? undefined : new Set<string>([repo]),
    sort,
    needsAttention: attentionOnly,
  }), [attentionOnly, ownership, repo, runtime, sort, status, workType]);
  const allInventory = useMobileWorkInventory();
  const inventory = useMobileWorkInventory(filters);
  const visibleInventory = useMemo(() => {
    const groups = inventory.groups.flatMap((group) => {
      const items = group.items.filter((item) => workspaceMatchesAgent(item, agent));
      return items.length > 0 ? [{ ...group, items }] : [];
    });
    return {
      groups,
      items: groups.flatMap((group) => group.items),
    };
  }, [agent, inventory.groups]);
  const repoOptions = useMemo(() => {
    return [...new Set(allInventory.items.map((item) => item.view.repoLabel))]
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
  }, [allInventory.items]);
  const activeFilterCount = [
    agent !== "all",
    workType !== "all",
    runtime !== "all",
    ownership !== "all",
    status !== "all",
    repo !== "all",
    sort !== "recent",
    attentionOnly,
  ].filter(Boolean).length;
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
          setAgent("all");
          setWorkType("all");
          setRuntime("all");
          setOwnership("all");
          setStatus("all");
          setRepo("all");
          setSort("recent");
          setAttentionOnly(false);
        }} />
        {AGENT_OPTIONS.filter((option) => option.id !== "all").map((option) => (
          <SummaryPill
            key={option.id}
            label={option.label}
            icon={option.icon}
            selected={agent === option.id}
            onPress={() => setAgent(agent === option.id ? "all" : option.id)}
          />
        ))}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.pills, styles.typePills]}
      >
        {WORK_TYPE_OPTIONS.map((option) => (
          <SummaryPill
            key={option.id}
            label={option.label}
            icon={option.icon}
            selected={workType === option.id}
            onPress={() => setWorkType(option.id)}
          />
        ))}
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
      ) : visibleInventory.items.length === 0 ? (
        <MobileEmptyState
          title="No matching workspaces"
          body="Adjust filters or start a new chat."
        />
      ) : (
        <View style={styles.groups}>
          {visibleInventory.groups.map((group) => (
            <View key={group.view.id} style={styles.group}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{group.view.label}</Text>
              </View>
              <View style={styles.cards}>
                {group.items.map((item) => (
                  <MobileWorkspaceCard
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
        workType={workType}
        runtime={runtime}
        ownership={ownership}
        status={status}
        repo={repo}
        sort={sort}
        repoOptions={repoOptions}
        onWorkType={setWorkType}
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
          setAgent("all");
          setWorkType("all");
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

function FilterSheet({
  visible,
  workType,
  runtime,
  ownership,
  status,
  repo,
  sort,
  repoOptions,
  onWorkType,
  onRuntime,
  onOwnership,
  onStatus,
  onRepo,
  onSort,
  onClear,
  onClose,
}: {
  visible: boolean;
  workType: WorkTypeFilter;
  runtime: RuntimeFilter;
  ownership: CloudWorkOwnerFilter;
  status: StatusFilter;
  repo: string;
  sort: CloudWorkSort;
  repoOptions: readonly string[];
  onWorkType: (value: WorkTypeFilter) => void;
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
                  title="Type"
                  value={optionLabel(WORK_TYPE_OPTIONS, workType)}
                  onPress={() => setPanel("type")}
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
            {panel === "type" ? WORK_TYPE_OPTIONS.map((option) => (
                <FilterChoice
                  key={option.id}
                  label={option.label}
                  icon={option.icon}
                  selected={workType === option.id}
                  onPress={() => onWorkType(option.id)}
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
    case "type":
      return "Type";
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

function semanticSourcesForWorkType(type: WorkTypeFilter): ReadonlySet<RecentWorkSourceKind> | undefined {
  switch (type) {
    case "cloud":
      return new Set<RecentWorkSourceKind>(["cloud_sandbox", "web", "mobile", "api"]);
    case "slack":
      return new Set<RecentWorkSourceKind>(["slack"]);
    case "personal_automation":
      return new Set<RecentWorkSourceKind>(["personal_automation"]);
    case "team_automation":
      return new Set<RecentWorkSourceKind>(["team_automation"]);
    case "dispatch":
      return new Set<RecentWorkSourceKind>(["desktop_exposed"]);
    case "all":
      return undefined;
  }
}

function workspaceMatchesAgent(item: MobileWorkItem, agent: AgentFilter): boolean {
  if (agent === "all") {
    return true;
  }
  return item.view.sourceAgentKind?.toLowerCase() === agent;
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
  typePills: {
    paddingTop: 0,
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
