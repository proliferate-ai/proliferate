import { Pressable, StyleSheet, Text, View } from "react-native";

import { MobileIcon } from "../primitives/MobileIcon";
import { MobileProliferateMark } from "../primitives/MobileProliferateMark";
import { colors, radius, spacing } from "../../styles/tokens";

interface MobileAuthScreenProps {
  onApple: () => void;
  onGitHub: () => void;
}

interface ProviderButtonProps {
  label: string;
  icon: "github" | "apple";
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}

function ProviderButton({ label, icon, onPress, primary, disabled }: ProviderButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={disabled ? "Sign-in is not enabled in this preview." : undefined}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.providerButton,
        primary ? styles.providerPrimary : styles.providerSecondary,
        disabled && styles.providerDisabled,
        pressed && styles.pressed,
      ]}
    >
      <MobileIcon
        name={icon}
        size={18}
        color={primary ? colors.background : colors.fg}
      />
      <Text
        style={[
          styles.providerLabel,
          primary ? styles.providerLabelPrimary : styles.providerLabelSecondary,
          disabled && styles.providerLabelDisabled,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function MobileAuthScreen({ onApple, onGitHub }: MobileAuthScreenProps) {
  return (
    <View style={styles.root}>
      <View style={styles.content}>
        <View style={styles.brand}>
          <MobileProliferateMark size={42} />
          <Text style={styles.wordmark}>Proliferate</Text>
        </View>
        <Text style={styles.tagline}>
          Run and orchestrate coding agents.
        </Text>

        <View style={styles.actions}>
          <ProviderButton
            label="Continue with GitHub"
            icon="github"
            onPress={onGitHub}
            primary
            disabled
          />
          <ProviderButton
            label="Continue with Apple"
            icon="apple"
            onPress={onApple}
            disabled
          />
        </View>

        <Text style={styles.note}>
          A GitHub connection is required to run cloud workspaces and automations.
        </Text>
      </View>

      <Text style={styles.legal}>
        By continuing you agree to the Proliferate{"\n"}Terms and Privacy Policy.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: spacing[6],
    paddingTop: spacing[12],
    paddingBottom: spacing[8],
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: {
    alignItems: "center",
    gap: spacing[3],
  },
  wordmark: {
    color: colors.fg,
    fontSize: 28,
    fontWeight: "600",
    letterSpacing: -0.4,
  },
  tagline: {
    color: colors.mutedForeground,
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing[3],
    textAlign: "center",
    maxWidth: 280,
  },
  actions: {
    alignSelf: "stretch",
    gap: spacing[2],
    marginTop: spacing[10],
  },
  providerButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: radius.xl,
  },
  providerPrimary: {
    backgroundColor: colors.fg,
  },
  providerSecondary: {
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  providerDisabled: {
    opacity: 0.48,
  },
  providerLabel: {
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
  providerLabelPrimary: {
    color: colors.background,
  },
  providerLabelSecondary: {
    color: colors.fg,
  },
  providerLabelDisabled: {
    color: colors.faint,
  },
  note: {
    marginTop: spacing[6],
    color: colors.faint,
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: "center",
    maxWidth: 280,
  },
  legal: {
    color: colors.sidebarMutedForeground,
    fontSize: 11.5,
    lineHeight: 17,
    textAlign: "center",
  },
  pressed: {
    opacity: 0.78,
  },
});
