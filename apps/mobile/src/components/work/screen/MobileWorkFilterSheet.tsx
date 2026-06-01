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
import { MobileIcon } from "../../primitives/MobileIcon";
import {
  MobileWorkFilterChoice,
  MobileWorkFilterSummaryRow,
} from "./MobileWorkFilterRows";

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
                <MobileWorkFilterSummaryRow
                  icon="workspaces"
                  title="Type"
                  value={mobileWorkOptionLabel(MOBILE_WORK_TYPE_OPTIONS, workType)}
                  onPress={() => setPanel("type")}
                />
                <MobileWorkFilterSummaryRow
                  icon="cloud"
                  title="Runtime"
                  value={mobileWorkOptionLabel(MOBILE_WORK_RUNTIME_OPTIONS, runtime)}
                  onPress={() => setPanel("runtime")}
                />
                <MobileWorkFilterSummaryRow
                  icon="users"
                  title="Ownership"
                  value={mobileWorkOptionLabel(MOBILE_WORK_OWNER_OPTIONS, ownership)}
                  onPress={() => setPanel("ownership")}
                />
                <MobileWorkFilterSummaryRow
                  icon="filter"
                  title="Status"
                  value={mobileWorkOptionLabel(MOBILE_WORK_STATUS_OPTIONS, status)}
                  onPress={() => setPanel("status")}
                />
                <MobileWorkFilterSummaryRow
                  icon="folder"
                  title="Repo"
                  value={repo === "all" ? "All repos" : repo}
                  onPress={() => setPanel("repo")}
                />
                <MobileWorkFilterSummaryRow
                  icon="controls"
                  title="Sort"
                  value={mobileWorkOptionLabel(MOBILE_WORK_SORT_OPTIONS, sort)}
                  onPress={() => setPanel("sort")}
                />
              </>
            ) : null}
            {panel === "type" ? MOBILE_WORK_TYPE_OPTIONS.map((option) => (
              <MobileWorkFilterChoice
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
              <MobileWorkFilterChoice
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
              <MobileWorkFilterChoice
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
              <MobileWorkFilterChoice
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
                <MobileWorkFilterChoice
                  label="All repos"
                  selected={repo === "all"}
                  onPress={() => {
                    onRepo("all");
                    setPanel(null);
                  }}
                />
                {repoOptions.map((option) => (
                  <MobileWorkFilterChoice
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
              <MobileWorkFilterChoice
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

const styles = StyleSheet.create({
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
  pressed: {
    opacity: 0.7,
  },
});
