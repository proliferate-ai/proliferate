import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "../../../styles/tokens";

interface MobileChatClaimBannerProps {
  claimPending: boolean;
  onClaim: () => void;
}

export function MobileChatClaimBanner({ claimPending, onClaim }: MobileChatClaimBannerProps) {
  return (
    <View style={styles.claimBanner}>
      <View style={styles.claimText}>
        <Text style={styles.claimTitle}>Unclaimed shared chat</Text>
        <Text style={styles.claimBody}>Claim this work before sending prompts from mobile.</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Claim shared chat"
        accessibilityState={{ disabled: claimPending }}
        disabled={claimPending}
        onPress={onClaim}
        style={({ pressed }) => [
          styles.claimButton,
          claimPending && styles.claimButtonDisabled,
          pressed && styles.claimButtonPressed,
        ]}
      >
        <Text style={styles.claimButtonText}>{claimPending ? "Claiming" : "Claim"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  claimBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    padding: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.successSubtle,
    backgroundColor: colors.successSubtle,
  },
  claimText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  claimTitle: {
    color: colors.fg,
    fontSize: 14,
    fontWeight: "600",
  },
  claimBody: {
    color: colors.mutedForeground,
    fontSize: 12.5,
    lineHeight: 17,
  },
  claimButton: {
    borderRadius: radius.md,
    backgroundColor: colors.success,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  claimButtonPressed: {
    opacity: 0.82,
  },
  claimButtonDisabled: {
    opacity: 0.56,
  },
  claimButtonText: {
    color: colors.background,
    fontSize: 12,
    fontWeight: "600",
  },
});
