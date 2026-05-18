import { Pressable, StyleSheet, Text, View } from "react-native";

import { MobileProliferateMark } from "../primitives/MobileProliferateMark";
import { colors, radius, text } from "../../styles/tokens";

interface MobileAuthScreenProps {
  onApple: () => void;
  onGitHub: () => void;
}

interface ProviderButtonProps {
  label: string;
  marker: string;
  onPress: () => void;
}

function ProviderButton({ label, marker, onPress }: ProviderButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.providerButton, pressed && styles.pressed]}
    >
      <View style={styles.providerMarker}>
        <Text style={styles.providerMarkerText}>{marker}</Text>
      </View>
      <Text style={styles.providerLabel}>{label}</Text>
    </Pressable>
  );
}

export function MobileAuthScreen({ onApple, onGitHub }: MobileAuthScreenProps) {
  return (
    <View style={styles.root}>
      <View style={styles.content}>
        <View style={styles.mark}>
          <MobileProliferateMark size={32} />
        </View>
        <Text style={styles.title}>Proliferate</Text>
        <Text style={styles.subtitle}>
          Run and orchestrate coding agents. Sign in to get started.
        </Text>

        <View style={styles.actions}>
          <ProviderButton label="Continue with GitHub" marker="GH" onPress={onGitHub} />
          <ProviderButton label="Continue with Apple" marker="A" onPress={onApple} />
        </View>

        <Text style={[text.caption, styles.note]}>
          A GitHub connection is required for cloud workspaces and automations.
        </Text>
      </View>
      <Text style={styles.legal}>
        By continuing you agree to the Proliferate Terms and Privacy Policy.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "space-between",
    padding: 28,
    backgroundColor: colors.bg,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  mark: {
    width: 66,
    height: 66,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  title: {
    color: colors.fg,
    fontSize: 26,
    fontWeight: "700",
    marginTop: 22,
  },
  subtitle: {
    maxWidth: 280,
    color: colors.mutedForeground,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: "center",
  },
  actions: {
    alignSelf: "stretch",
    gap: 11,
    marginTop: 40,
    marginBottom: 16,
  },
  providerButton: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 11,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  providerMarker: {
    width: 24,
    alignItems: "center",
  },
  providerMarkerText: {
    color: colors.fg,
    fontSize: 12,
    fontWeight: "800",
  },
  providerLabel: {
    color: colors.fg,
    fontSize: 15,
    fontWeight: "700",
  },
  note: {
    maxWidth: 290,
    textAlign: "center",
  },
  legal: {
    color: colors.sidebarMutedForeground,
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
  },
  pressed: {
    opacity: 0.72,
  },
});
