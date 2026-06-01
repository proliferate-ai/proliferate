import { Pressable, StyleSheet, Text, View } from "react-native";

import { MobileIcon } from "../../primitives/MobileIcon";
import { MobileTextInput } from "../../primitives/MobileTextInput";
import { colors, radius, spacing } from "../../../styles/tokens";

interface MobileChatComposerProps {
  draft: string;
  placeholder: string;
  controlLabel: string;
  controlPending: boolean;
  canSubmit: boolean;
  keyboardInset: number;
  onChangeDraft: (value: string) => void;
  onOpenSettings: () => void;
  onSubmit: () => void;
}

export function MobileChatComposer({
  draft,
  placeholder,
  controlLabel,
  controlPending,
  canSubmit,
  keyboardInset,
  onChangeDraft,
  onOpenSettings,
  onSubmit,
}: MobileChatComposerProps) {
  return (
    <View style={[styles.composer, keyboardInset > 0 && { marginBottom: keyboardInset }]}>
      <View style={styles.composerCard}>
        <MobileTextInput
          multiline
          value={draft}
          onChangeText={onChangeDraft}
          placeholder={placeholder}
          style={styles.composerInput}
        />
        <View style={styles.composerFooter}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open chat settings"
            onPress={onOpenSettings}
            style={({ pressed }) => [
              styles.configLink,
              controlPending && styles.configLinkPending,
              pressed && styles.configLinkPressed,
            ]}
          >
            <Text style={styles.configLinkText} numberOfLines={1}>
              {controlLabel}
            </Text>
            <MobileIcon name="chevron-down" size={10} color={colors.faint} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSubmit }}
            disabled={!canSubmit}
            onPress={onSubmit}
            style={({ pressed }) => [
              styles.send,
              !canSubmit && styles.sendDisabled,
              pressed && styles.sendPressed,
            ]}
          >
            <MobileIcon name="send" size={18} color={canSubmit ? colors.background : colors.faint} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  composer: {
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    paddingBottom: spacing[3],
    backgroundColor: colors.background,
  },
  composerCard: {
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
    gap: spacing[2],
  },
  composerInput: {
    minHeight: 23,
    maxHeight: 200,
    borderWidth: 0,
    backgroundColor: "transparent",
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    color: colors.fg,
    fontSize: 17,
    lineHeight: 23,
  },
  composerFooter: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
  },
  configLink: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "82%",
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.md,
    paddingHorizontal: 2,
    paddingVertical: 0,
  },
  configLinkPending: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing[2],
  },
  configLinkPressed: {
    opacity: 0.82,
  },
  configLinkText: {
    flexShrink: 1,
    minWidth: 0,
    color: colors.mutedForeground,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "400",
    includeFontPadding: false,
  },
  send: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.fg,
  },
  sendDisabled: {
    backgroundColor: colors.accent,
  },
  sendPressed: {
    opacity: 0.85,
  },
});
