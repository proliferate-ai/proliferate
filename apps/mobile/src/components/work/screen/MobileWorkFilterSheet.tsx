import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type {
  CloudWorkOwnerFilter,
  CloudWorkSort,
} from "@proliferate/product-domain/workspaces/cloud-work-inventory";

import {
  MOBILE_WORK_OWNER_OPTIONS,
  MOBILE_WORK_RUNTIME_OPTIONS,
  MOBILE_WORK_SORT_OPTIONS,
  MOBILE_WORK_STATUS_OPTIONS,
  MOBILE_WORK_TYPE_OPTIONS,
  mobileWorkFilterPanelTitle,
  mobileWorkOptionLabel,
  type MobileWorkFilterPanel,
  type MobileWorkRuntimeFilter,
  type MobileWorkStatusFilter,
  type MobileWorkTypeFilter,
} from "../../../lib/domain/work/mobile-work-filters";
import { colors, radius, spacing } from "../../../styles/tokens";
import { MobileIcon, type MobileIconName } from "../../primitives/MobileIcon";

interface MobileWorkFilterSheetProps {
  visible: boolean;
  workType: MobileWorkTypeFilter;
  runtime: MobileWorkRuntimeFilter;
  ownership: CloudWorkOwnerFilter;
  status: MobileWorkStatusFilter;
  repo: string;
  sort: CloudWorkSort;
  repoOptions: readonly string[];
  onWorkType: (value: MobileWorkTypeFilter) => void;
  onRuntime: (value: MobileWorkRuntimeFilter) => void;
  onOwnership: (value: CloudWorkOwnerFilter) => void;
  onStatus: (value: MobileWorkStatusFilter) => void;
  onRepo: (value: string) => void;
  onSort: (value: CloudWorkSort) => void;
  onClear: () => void;
  onClose: () => void;
}

export function MobileWorkSummaryPill({
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

export function MobileWorkFilterSheet({
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
}: MobileWorkFilterSheetProps) {
  const [panel, setPanel] = useState<MobileWorkFilterPanel | null>(null);

  useEffect(() => {
    if (!visible) {
      setPanel(null);
    }
  }, [visible]);

  const panelTitle = panel ? mobileWorkFilterPanelTitle(panel) : "Filter workspaces";

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
                  value={mobileWorkOptionLabel(MOBILE_WORK_TYPE_OPTIONS, workType)}
                  onPress={() => setPanel("type")}
                />
                <FilterSummaryRow
                  icon="cloud"
                  title="Runtime"
                  value={mobileWorkOptionLabel(MOBILE_WORK_RUNTIME_OPTIONS, runtime)}
                  onPress={() => setPanel("runtime")}
                />
                <FilterSummaryRow
                  icon="users"
                  title="Ownership"
                  value={mobileWorkOptionLabel(MOBILE_WORK_OWNER_OPTIONS, ownership)}
                  onPress={() => setPanel("ownership")}
                />
                <FilterSummaryRow
                  icon="filter"
                  title="Status"
                  value={mobileWorkOptionLabel(MOBILE_WORK_STATUS_OPTIONS, status)}
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
                  value={mobileWorkOptionLabel(MOBILE_WORK_SORT_OPTIONS, sort)}
                  onPress={() => setPanel("sort")}
                />
              </>
            ) : null}
            {panel === "type" ? MOBILE_WORK_TYPE_OPTIONS.map((option) => (
              <FilterChoice
                key={option.id}
                label={option.label}
                icon={option.icon}
                selected={workType === option.id}
                onPress={() => {
                  onWorkType(option.id);
                  setPanel(null);
                }}
              />
            )) : null}
            {panel === "runtime" ? MOBILE_WORK_RUNTIME_OPTIONS.map((option) => (
              <FilterChoice
                key={option.id}
                label={option.label}
                icon={option.icon}
                selected={runtime === option.id}
                onPress={() => {
                  onRuntime(option.id);
                  setPanel(null);
                }}
              />
            )) : null}
            {panel === "ownership" ? MOBILE_WORK_OWNER_OPTIONS.map((option) => (
              <FilterChoice
                key={option.id}
                label={option.label}
                selected={ownership === option.id}
                onPress={() => {
                  onOwnership(option.id);
                  setPanel(null);
                }}
              />
            )) : null}
            {panel === "status" ? MOBILE_WORK_STATUS_OPTIONS.map((option) => (
              <FilterChoice
                key={option.id}
                label={option.label}
                selected={status === option.id}
                onPress={() => {
                  onStatus(option.id);
                  setPanel(null);
                }}
              />
            )) : null}
            {panel === "repo" ? (
              <>
                <FilterChoice
                  label="All repos"
                  selected={repo === "all"}
                  onPress={() => {
                    onRepo("all");
                    setPanel(null);
                  }}
                />
                {repoOptions.map((option) => (
                  <FilterChoice
                    key={option}
                    label={option}
                    icon="folder"
                    selected={repo === option}
                    onPress={() => {
                      onRepo(option);
                      setPanel(null);
                    }}
                  />
                ))}
              </>
            ) : null}
            {panel === "sort" ? MOBILE_WORK_SORT_OPTIONS.map((option) => (
              <FilterChoice
                key={option.id}
                label={option.label}
                selected={sort === option.id}
                onPress={() => {
                  onSort(option.id);
                  setPanel(null);
                }}
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
