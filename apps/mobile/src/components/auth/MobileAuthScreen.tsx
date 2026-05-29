import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import type { AuthProviderName } from "@proliferate/cloud-sdk";
import {
  AUTH_PROVIDER_ORDER,
  AUTH_SIGN_IN_COPY,
  authProviderPresentation,
} from "@proliferate/product-domain/auth/presentation";

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
          <MobileProliferateMark size={40} />
          <Text style={styles.title}>{AUTH_SIGN_IN_COPY.title}</Text>
          <Text style={styles.subtitle}>{AUTH_SIGN_IN_COPY.subtitle}</Text>
        </View>

        <View style={styles.actions}>
          {AUTH_PROVIDER_ORDER.map((provider) => (
            <ProviderButton
              key={provider}
              label={authProviderPresentation(provider).actionLabel}
              icon={providerIcon(provider)}
              provider={provider}
              onPress={onProvider}
              loading={loadingAction === provider}
              disabled={busy}
              primary={provider === "github"}
            />
          ))}
        </View>

        <Text style={styles.note}>{AUTH_SIGN_IN_COPY.note}</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <Text style={styles.legal}>{AUTH_SIGN_IN_COPY.footer}</Text>
    </View>
  );
}

function providerIcon(provider: AuthProviderName): Extract<MobileIconName, "github" | "apple" | "google"> {
  if (provider === "github") {
    return "github";
  }
  if (provider === "apple") {
    return "apple";
  }
  return "google";
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
    alignItems: "stretch",
    justifyContent: "center",
  },
  brand: {
    alignItems: "flex-start",
    gap: spacing[4],
  },
  title: {
    color: colors.fg,
    fontSize: 30,
    fontWeight: "600",
    letterSpacing: -0.2,
    lineHeight: 36,
  },
  subtitle: {
    color: colors.mutedForeground,
    fontSize: 14.5,
    lineHeight: 22,
    maxWidth: 340,
  },
  actions: {
    alignSelf: "stretch",
    gap: spacing[2],
    marginTop: spacing[8],
  },
  providerButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: radius.md,
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
    marginTop: spacing[5],
    color: colors.faint,
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: "left",
    maxWidth: 340,
  },
  legal: {
    color: colors.sidebarMutedForeground,
    fontSize: 11.5,
    lineHeight: 17,
    textAlign: "left",
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
    textAlign: "left",
  },
});
