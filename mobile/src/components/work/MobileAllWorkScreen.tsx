import { useMemo, useState } from "react";
import type { ReactNode } from "react";
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
  CloudWorkSource,
  CloudWorkStatusFilter,
  RecentWorkSourceKind,
} from "@proliferate/product-model/workspaces/cloud-work-inventory";

import { useMobileWorkInventory, type MobileWorkItem } from "../../hooks/work/derived/use-mobile-work-inventory";
import type { MobileCloudChat } from "../../navigation/navigation-model";
import { MobileIcon, type MobileIconName } from "../primitives/MobileIcon";
import { MobileListRow } from "../primitives/MobileListRow";
import {
  MobileEmptyState,
  MobileScreen,
  MobileSectionLabel,
} from "../primitives/MobileLayout";
import { MobileTextInput } from "../primitives/MobileTextInput";
import { colors, radius, spacing } from "../../styles/tokens";

interface MobileAllWorkScreenProps {
  onOpenChat: (chat: MobileCloudChat) => void;
}

type SourceFilter = CloudWorkSource | "all";
type StatusFilter = CloudWorkStatusFilter | "all";

const SOURCE_OPTIONS: readonly { id: SourceFilter; label: string; icon: MobileIconName }[] = [
  { id: "all", label: "All sources", icon: "workspaces" },
  { id: "chats", label: "Chats", icon: "sessions" },
  { id: "slack", label: "Slack", icon: "slack" },
  { id: "automation", label: "Automations", icon: "calendar-clock" },
  { id: "api", label: "API", icon: "cloud" },
];

const OWNER_OPTIONS: readonly { id: CloudWorkOwnerFilter; label: string }[] = [
  { id: "all", label: "All work" },
  { id: "private", label: "Private" },
  { id: "unclaimed", label: "Unclaimed" },
  { id: "claimed", label: "Claimed" },
  { id: "shared", label: "Shared" },
];

const STATUS_OPTIONS: readonly { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All status" },
  { id: "active", label: "Active" },
  { id: "blocked", label: "Blocked" },
  { id: "ready", label: "Ready" },
  { id: "error", label: "Error" },
];

export function MobileAllWorkScreen({ onOpenChat }: MobileAllWorkScreenProps) {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [ownership, setOwnership] = useState<CloudWorkOwnerFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const filters = useMemo(() => ({
    search,
    ownership,
    sources: source === "all" ? undefined : new Set<CloudWorkSource>([source]),
    statuses: status === "all" ? undefined : new Set<CloudWorkStatusFilter>([status]),
  }), [ownership, search, source, status]);
  const inventory = useMobileWorkInventory(filters);
  const activeFilterCount = [
    source !== "all",
    ownership !== "all",
    status !== "all",
    Boolean(search.trim()),
  ].filter(Boolean).length;

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
      <View style={styles.toolbar}>
        <View style={styles.searchBox}>
          <MobileIcon name="search" size={15} color={colors.faint} />
          <MobileTextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search work"
            style={styles.searchInput}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Filter work"
          onPress={() => setFilterOpen(true)}
          style={({ pressed }) => [styles.filterButton, pressed && styles.pressed]}
        >
          <MobileIcon name="filter" size={16} color={colors.fg} />
          {activeFilterCount ? <Text style={styles.filterCount}>{activeFilterCount}</Text> : null}
        </Pressable>
      </View>

      {inventory.error && inventory.items.length > 0 ? (
        <View style={styles.partialWarning}>
          <MobileIcon name="cloud" size={13} color={colors.warning} />
          <Text style={styles.partialWarningText}>
            Some work could not refresh. Showing the work that loaded.
          </Text>
        </View>
      ) : null}

      {inventory.isLoading ? (
        <MobileEmptyState title="Loading work" body="Fetching your visible cloud work." />
      ) : inventory.error && inventory.items.length === 0 ? (
        <MobileEmptyState title="Could not load work" body="Pull to refresh or sign in again." />
      ) : inventory.items.length === 0 ? (
        <MobileEmptyState
          title="No matching work"
          body="Try clearing filters, or start a new cloud chat from Home."
        />
      ) : (
        <View style={styles.groups}>
          {inventory.groups.map((group) => (
            <View key={group.view.id} style={styles.group}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitle}>
                  <SourceGlyph source={group.view.id} />
                  <MobileSectionLabel>{group.view.label}</MobileSectionLabel>
                </View>
                <Text style={styles.sectionCount}>{group.items.length}</Text>
              </View>
              <View style={styles.list}>
                {group.items.map((item) => (
                  <WorkRow
                    key={item.view.id}
                    item={item}
                    onPress={() => onOpenChat(item.chat)}
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
        ownership={ownership}
        status={status}
        onSource={setSource}
        onOwnership={setOwnership}
        onStatus={setStatus}
        onClear={() => {
          setSource("all");
          setOwnership("all");
          setStatus("all");
          setSearch("");
        }}
        onClose={() => setFilterOpen(false)}
      />
    </MobileScreen>
  );
}

function WorkRow({ item, onPress }: { item: MobileWorkItem; onPress: () => void }) {
  return (
    <MobileListRow
      leading={
        <View style={styles.iconBox}>
          <SourceGlyph source={item.view.sourceKind} />
        </View>
      }
      title={item.view.title}
      subtitle={`${item.view.repoLabel} - ${item.view.branchLabel} - ${item.view.runtimeLocationLabel}`}
      trailing={
        <View style={styles.trailing}>
          <Text style={styles.last}>{item.view.lastActivityLabel}</Text>
          <View style={[
            styles.statusPill,
            item.view.status === "blocked" && styles.statusBlocked,
            item.view.status === "active" && styles.statusActive,
            item.view.unclaimed && styles.statusUnclaimed,
          ]}>
            {item.view.unclaimed ? (
              <MobileIcon name="hand" size={10} color={colors.success} />
            ) : null}
            <Text style={[
              styles.statusText,
              item.view.status === "blocked" && styles.statusTextBlocked,
              item.view.status === "active" && styles.statusTextActive,
              item.view.unclaimed && styles.statusTextUnclaimed,
            ]}>
              {item.view.unclaimed ? "Claim" : item.view.commandabilityLabel}
            </Text>
          </View>
        </View>
      }
      showChevron
      onPress={onPress}
    />
  );
}

function SourceGlyph({ source }: { source: CloudWorkSource | RecentWorkSourceKind }) {
  const option = SOURCE_OPTIONS.find((candidate) => candidate.id === source);
  const semanticIcon = semanticSourceIcon(source);
  return (
    <MobileIcon
      name={option?.icon ?? semanticIcon}
      size={16}
      color={source === "slack" ? colors.success : colors.mutedForeground}
    />
  );
}

function semanticSourceIcon(source: CloudWorkSource | RecentWorkSourceKind): MobileIconName {
  switch (source) {
    case "desktop_exposed":
      return "folder";
    case "cloud_sandbox":
      return "cloud";
    case "web":
      return "workspaces";
    case "mobile":
      return "smartphone";
    case "personal_automation":
    case "team_automation":
      return "calendar-clock";
    case "slack":
      return "slack";
    case "api":
      return "cloud";
    case "chats":
      return "sessions";
    case "automation":
      return "calendar-clock";
    case "unknown":
    default:
      return "workspaces";
  }
}

function FilterSheet({
  visible,
  source,
  ownership,
  status,
  onSource,
  onOwnership,
  onStatus,
  onClear,
  onClose,
}: {
  visible: boolean;
  source: SourceFilter;
  ownership: CloudWorkOwnerFilter;
  status: StatusFilter;
  onSource: (value: SourceFilter) => void;
  onOwnership: (value: CloudWorkOwnerFilter) => void;
  onStatus: (value: StatusFilter) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetLayer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close filters"
          style={styles.sheetScrim}
          onPress={onClose}
        />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Filter work</Text>
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
            <FilterGroup title="Owner">
              {OWNER_OPTIONS.map((option) => (
                <FilterChoice
                  key={option.id}
                  label={option.label}
                  selected={ownership === option.id}
                  onPress={() => onOwnership(option.id)}
                />
              ))}
            </FilterGroup>
            <FilterGroup title="Source">
              {SOURCE_OPTIONS.map((option) => (
                <FilterChoice
                  key={option.id}
                  label={option.label}
                  icon={option.icon}
                  selected={source === option.id}
                  onPress={() => onSource(option.id)}
                />
              ))}
            </FilterGroup>
            <FilterGroup title="Status">
              {STATUS_OPTIONS.map((option) => (
                <FilterChoice
                  key={option.id}
                  label={option.label}
                  selected={status === option.id}
                  onPress={() => onStatus(option.id)}
                />
              ))}
            </FilterGroup>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.filterGroup}>
      <MobileSectionLabel>{title}</MobileSectionLabel>
      <View style={styles.choiceGrid}>{children}</View>
    </View>
  );
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
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  searchBox: {
    flex: 1,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[3],
  },
  searchInput: {
    flex: 1,
    minHeight: 36,
    paddingVertical: 0,
    paddingHorizontal: 0,
    backgroundColor: "transparent",
    borderWidth: 0,
  },
  filterButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  filterCount: {
    position: "absolute",
    top: 5,
    right: 5,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: colors.fg,
    color: colors.background,
    fontSize: 10,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 15,
  },
  groups: {
    paddingBottom: spacing[8],
  },
  partialWarning: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    marginHorizontal: spacing[4],
    marginTop: spacing[3],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.warningSubtle,
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
    gap: spacing[1],
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[1],
  },
  sectionTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  sectionCount: {
    color: colors.faint,
    fontSize: 11.5,
    fontWeight: "600",
  },
  list: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight,
  },
  iconBox: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  trailing: {
    alignItems: "flex-end",
    gap: 4,
  },
  last: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: "500",
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusActive: {
    backgroundColor: colors.infoSubtle,
  },
  statusBlocked: {
    backgroundColor: colors.destructiveSubtle,
  },
  statusUnclaimed: {
    backgroundColor: colors.successSubtle,
  },
  statusText: {
    color: colors.faint,
    fontSize: 10.5,
    fontWeight: "700",
  },
  statusTextActive: {
    color: colors.info,
  },
  statusTextBlocked: {
    color: colors.destructive,
  },
  statusTextUnclaimed: {
    color: colors.success,
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
    maxHeight: "82%",
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
  },
  sheetTitle: {
    color: colors.fg,
    fontSize: 18,
    fontWeight: "700",
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
  filterGroup: {
    gap: spacing[2],
  },
  choiceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  choice: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[3],
  },
  choiceSelected: {
    borderColor: colors.fg,
    backgroundColor: colors.accent,
  },
  choiceText: {
    color: colors.faint,
    fontSize: 12,
    fontWeight: "600",
  },
  choiceTextSelected: {
    color: colors.fg,
  },
  pressed: {
    opacity: 0.7,
  },
});
