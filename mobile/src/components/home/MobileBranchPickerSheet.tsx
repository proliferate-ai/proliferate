import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { MobileIcon } from "../primitives/MobileIcon";
import { MobileTextInput } from "../primitives/MobileTextInput";
import { colors, radius, spacing } from "../../styles/tokens";

interface MobileBranchPickerSheetProps {
  visible: boolean;
  loading?: boolean;
  branches: readonly string[];
  selectedBranch: string | null;
  repoLabel?: string | null;
  onSelect: (branch: string) => void;
  onClose: () => void;
}

const MAX_VISIBLE_BRANCHES = 80;

export function MobileBranchPickerSheet({
  visible,
  loading = false,
  branches,
  selectedBranch,
  repoLabel,
  onSelect,
  onClose,
}: MobileBranchPickerSheetProps) {
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const filteredBranches = useMemo(
    () => branches
      .filter((branch) => branchMatchesQuery(branch, trimmedQuery))
      .slice(0, MAX_VISIBLE_BRANCHES),
    [branches, trimmedQuery],
  );
  const hiddenCount = Math.max(0, branches.length - filteredBranches.length);

  function close() {
    setQuery("");
    onClose();
  }

  function select(branch: string) {
    setQuery("");
    onSelect(branch);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: "padding", default: undefined })}
        style={styles.layer}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close branch picker"
          style={styles.scrim}
          onPress={close}
        />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <View style={styles.titleBlock}>
              <Text style={styles.title}>Branch</Text>
              {repoLabel ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {repoLabel}
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close branch picker"
              onPress={close}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            >
              <MobileIcon name="close" size={18} color={colors.fg} />
            </Pressable>
          </View>

          <View style={styles.searchBox}>
            <MobileIcon name="search" size={16} color={colors.faint} />
            <MobileTextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="Search branches"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.searchInput}
            />
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {loading ? (
              <BranchMessage text="Loading branches" />
            ) : filteredBranches.length === 0 ? (
              <BranchMessage text="No matching branches" />
            ) : (
              filteredBranches.map((branch) => (
                <BranchRow
                  key={branch}
                  branch={branch}
                  selected={branch === selectedBranch}
                  onPress={() => select(branch)}
                />
              ))
            )}
            {!loading && hiddenCount > 0 ? (
              <Text style={styles.hiddenCount}>
                {hiddenCount} more hidden by search
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function BranchRow({
  branch,
  selected,
  onPress,
}: {
  branch: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.branchRow,
        selected && styles.branchRowSelected,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.branchIcon}>
        <MobileIcon name="git-branch" size={15} color={selected ? colors.fg : colors.faint} />
      </View>
      <Text style={[styles.branchText, selected && styles.branchTextSelected]} numberOfLines={1}>
        {branch}
      </Text>
      {selected ? <MobileIcon name="check" size={16} color={colors.fg} /> : null}
    </Pressable>
  );
}

function BranchMessage({ text }: { text: string }) {
  return (
    <View style={styles.message}>
      <Text style={styles.messageText}>{text}</Text>
    </View>
  );
}

function branchMatchesQuery(branch: string, query: string): boolean {
  if (!query) {
    return true;
  }
  const normalizedBranch = branch.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((part) => normalizedBranch.includes(part));
}

const styles = StyleSheet.create({
  layer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.48)",
  },
  sheet: {
    maxHeight: "76%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderHeavy,
    backgroundColor: colors.popover,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[5],
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderHeavy,
    marginBottom: spacing[3],
  },
  header: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.fg,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
  },
  subtitle: {
    color: colors.faint,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: "500",
  },
  closeButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  searchBox: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderHeavy,
    backgroundColor: colors.background,
    paddingHorizontal: spacing[3],
    marginTop: spacing[3],
  },
  searchInput: {
    flex: 1,
    minHeight: 42,
    borderWidth: 0,
    backgroundColor: "transparent",
    paddingHorizontal: 0,
    color: colors.fg,
    fontSize: 15,
  },
  list: {
    marginTop: spacing[3],
  },
  listContent: {
    gap: spacing[1],
    paddingBottom: spacing[2],
  },
  branchRow: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: 16,
    paddingHorizontal: spacing[3],
  },
  branchRowSelected: {
    backgroundColor: colors.accent,
  },
  branchIcon: {
    width: 20,
    alignItems: "center",
  },
  branchText: {
    flex: 1,
    minWidth: 0,
    color: colors.mutedForeground,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "500",
  },
  branchTextSelected: {
    color: colors.fg,
    fontWeight: "700",
  },
  message: {
    minHeight: 86,
    alignItems: "center",
    justifyContent: "center",
  },
  messageText: {
    color: colors.faint,
    fontSize: 14,
    fontWeight: "500",
  },
  hiddenCount: {
    alignSelf: "center",
    color: colors.faint,
    fontSize: 12,
    paddingVertical: spacing[2],
  },
  pressed: {
    opacity: 0.72,
  },
});
