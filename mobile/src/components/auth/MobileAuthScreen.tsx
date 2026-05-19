import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import type { AuthProviderName } from "@proliferate/cloud-sdk";

import { MobileIcon, type MobileIconName } from "../primitives/MobileIcon";
import { MobileProliferateMark } from "../primitives/MobileProliferateMark";
import { colors, radius, spacing } from "../../styles/tokens";
import type { MobileAuthAction } from "../../providers/MobileAuthProvider";

interface MobileAuthScreenProps {
  onProvider: (provider: AuthProviderName) => void;
  loadingAction: MobileAuthAction;
  error: string | null;
}

interface ProviderButtonProps {
  label: string;
  icon: Extract<MobileIconName, "github" | "apple" | "google">;
  provider: AuthProviderName;
  onPress: (provider: AuthProviderName) => void;
  loading?: boolean;
  disabled?: boolean;
  primary?: boolean;
}

function ProviderButton({
  label,
  icon,
  provider,
  onPress,
  loading = false,
  disabled = false,
  primary = false,
}: ProviderButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={() => onPress(provider)}
      style={({ pressed }) => [
        styles.providerButton,
        primary ? styles.providerPrimary : styles.providerSecondary,
        pressed && !disabled && !loading && styles.pressed,
        (disabled || loading) && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={primary ? colors.background : colors.fg} />
      ) : (
        <MobileIcon
          name={icon}
          size={18}
          color={primary ? colors.background : colors.fg}
        />
      )}
      <Text
        style={[
          styles.providerLabel,
          primary ? styles.providerLabelPrimary : styles.providerLabelSecondary,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function MobileAuthScreen({
  onProvider,
  loadingAction,
  error,
}: MobileAuthScreenProps) {
  const busy = Boolean(loadingAction);

  return (
    <View style={styles.root}>
      <View style={styles.content}>
        <View style={styles.brand}>
          <MobileProliferateMark size={42} />
          <Text style={styles.wordmark}>Proliferate</Text>
        </View>
        <Text style={styles.tagline}>
          Run and orchestrate coding agents.
          {"\n"}
          Sign in to get started.
        </Text>

        <View style={styles.actions}>
          <ProviderButton
            label="Continue with GitHub"
            icon="github"
            provider="github"
            onPress={onProvider}
            loading={loadingAction === "github"}
            disabled={busy}
            primary
          />
          <ProviderButton
            label="Continue with Apple"
            icon="apple"
            provider="apple"
            onPress={onProvider}
            loading={loadingAction === "apple"}
            disabled={busy}
          />
          <ProviderButton
            label="Continue with Google"
            icon="google"
            provider="google"
            onPress={onProvider}
            loading={loadingAction === "google"}
            disabled={busy}
          />
        </View>

        <Text style={styles.note}>
          GitHub is required for cloud workspaces and automations. You can link it
          after signing in with Apple or Google.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
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
  disabled: {
    opacity: 0.55,
  },
  error: {
    alignSelf: "stretch",
    marginTop: spacing[4],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(250,66,62,0.35)",
    backgroundColor: "rgba(250,66,62,0.10)",
    color: colors.red,
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlign: "center",
  },
});
