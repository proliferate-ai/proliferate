import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useMobileRepositoryPicker } from "../../../hooks/settings/facade/use-mobile-repository-picker";
import { useMobileSettingsSheetSlide } from "../../../hooks/settings/ui/use-mobile-settings-sheet-slide";
import { colors, radius, spacing } from "../../../styles/tokens";
import { MobileIcon } from "../../primitives/MobileIcon";

interface MobileAddRepositoryModalProps {
  visible: boolean;
  configuredKeys: ReadonlySet<string>;
  onClose: () => void;
  onSaved: () => void;
}

export function MobileAddRepositoryModal({
  visible,
  configuredKeys,
  onClose,
  onSaved,
}: MobileAddRepositoryModalProps) {
  const repositoryPicker = useMobileRepositoryPicker({
    configuredKeys,
    visible,
    onSaved,
    onClose,
  });
  const slideUp = useMobileSettingsSheetSlide(visible);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalLayer}>
        <Pressable style={styles.modalScrim} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <Animated.View style={[styles.modalSheet, { transform: [{ translateY: slideUp }] }]}>
          <View style={styles.modalGrabber} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add repository</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={({ pressed }) => [styles.modalCloseButton, pressed && styles.pressed]}
            >
              <MobileIcon name="close" size={16} color={colors.fg} />
            </Pressable>
          </View>
          <View style={styles.searchWrap}>
            <MobileIcon name="search" size={15} color={colors.faint} />
            <TextInput
              value={repositoryPicker.query}
              onChangeText={repositoryPicker.setQuery}
              placeholder="Search your repositories"
              placeholderTextColor={colors.faint}
              autoCorrect={false}
              autoCapitalize="none"
              style={styles.searchInput}
            />
            {repositoryPicker.query ? (
              <Pressable accessibilityRole="button" onPress={() => repositoryPicker.setQuery("")}>
                <MobileIcon name="close" size={14} color={colors.faint} />
              </Pressable>
            ) : null}
          </View>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            {repositoryPicker.repos.isLoading ? (
              <View style={styles.modalEmpty}>
                <ActivityIndicator color={colors.faint} />
                <Text style={styles.modalEmptyText}>Loading your GitHub repos...</Text>
              </View>
            ) : repositoryPicker.repos.isError ? (
              <Text style={styles.modalEmptyText}>Could not load repositories.</Text>
            ) : repositoryPicker.available.length === 0 ? (
              <Text style={styles.modalEmptyText}>
                {repositoryPicker.query ? "No matches." : "All your repos are already configured."}
              </Text>
            ) : (
              repositoryPicker.available.map((repo) => {
                const key = `${repo.gitOwner}/${repo.gitRepoName}`;
                const busy = repositoryPicker.busyKey === key;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    disabled={Boolean(repositoryPicker.busyKey)}
                    onPress={() => void repositoryPicker.pickRepository(
                      repo.gitOwner,
                      repo.gitRepoName,
                      repo.defaultBranch ?? null,
                    )}
                    style={({ pressed }) => [
                      styles.repoRow,
                      pressed && styles.rowPressed,
                      busy && styles.repoRowBusy,
                    ]}
                  >
                    <MobileIcon name="git-branch" size={17} color={colors.fg} />
                    <View style={styles.repoText}>
                      <Text style={styles.repoTitle} numberOfLines={1}>{repo.fullName}</Text>
                      {repo.defaultBranch ? (
                        <Text style={styles.repoSubtitle} numberOfLines={1}>{repo.defaultBranch}</Text>
                      ) : null}
                    </View>
                    {busy ? (
                      <ActivityIndicator color={colors.faint} />
                    ) : (
                      <MobileIcon name="chevron-right" size={15} color={colors.faint} />
                    )}
                  </Pressable>
                );
              })
            )}
            {repositoryPicker.error ? <Text style={styles.modalErrorText}>{repositoryPicker.error}</Text> : null}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.78,
  },
  modalLayer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  modalSheet: {
    maxHeight: "82%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: colors.popover,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingTop: spacing[1],
    paddingBottom: spacing[4],
  },
  modalGrabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderHeavy,
    alignSelf: "center",
    marginTop: 6,
    marginBottom: 6,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[2],
  },
  modalTitle: {
    color: colors.fg,
    fontSize: 15,
    fontWeight: "600",
  },
  modalCloseButton: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  searchWrap: {
    marginHorizontal: spacing[3],
    marginBottom: spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing[3],
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    color: colors.fg,
    fontSize: 14,
  },
  modalScroll: {
    minHeight: 0,
  },
  modalContent: {
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[4],
    gap: 2,
  },
  modalEmpty: {
    alignItems: "center",
    gap: spacing[2],
    paddingVertical: spacing[5],
  },
  modalEmptyText: {
    color: colors.faint,
    fontSize: 13,
    textAlign: "center",
  },
  modalErrorText: {
    color: colors.destructive,
    fontSize: 12.5,
    paddingHorizontal: spacing[2],
    paddingTop: spacing[2],
  },
  repoRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: 12,
  },
  rowPressed: {
    backgroundColor: colors.accent,
  },
  repoRowBusy: {
    opacity: 0.7,
  },
  repoText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  repoTitle: {
    color: colors.fg,
    fontSize: 14.5,
    fontWeight: "500",
  },
  repoSubtitle: {
    color: colors.faint,
    fontSize: 12,
  },
});
