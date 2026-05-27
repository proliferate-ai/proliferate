import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import {
  AUTH_REQUIRED_GITHUB_COPY,
  authProviderPresentation,
} from "@proliferate/product-model/auth/presentation";

import { MobileIcon } from "../primitives/MobileIcon";
import { MobileProliferateMark } from "../primitives/MobileProliferateMark";
import { colors, radius, spacing } from "../../styles/tokens";

interface MobileConnectGitHubScreenProps {
  onConnect: () => void;
  onSignOut: () => void;
  loading?: boolean;
  error?: string | null;
}

export function MobileConnectGitHubScreen({
  onConnect,
  onSignOut,
  loading = false,
  error = null,
}: MobileConnectGitHubScreenProps) {
  return (
    <View style={styles.root}>
      <View style={styles.content}>
        <View style={styles.header}>
          <MobileProliferateMark size={36} />
          <Text style={styles.title}>{AUTH_REQUIRED_GITHUB_COPY.title}</Text>
          <Text style={styles.body}>{AUTH_REQUIRED_GITHUB_COPY.subtitle}</Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: loading }}
            disabled={loading}
            onPress={onConnect}
            style={({ pressed }) => [
              styles.primary,
              pressed && !loading && styles.pressed,
              loading && styles.disabled,
            ]}
          >
            {loading ? (
              <ActivityIndicator size="small" color={colors.background} />
            ) : (
              <MobileIcon name="github" size={18} color={colors.background} />
            )}
            <Text style={styles.primaryLabel}>
              {authProviderPresentation("github").actionLabel}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={onSignOut}
            style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}
          >
            <Text style={styles.signOutLabel}>Sign out</Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <Text style={styles.fineprint}>{AUTH_REQUIRED_GITHUB_COPY.footer}</Text>
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
    alignItems: "stretch",
    justifyContent: "center",
  },
  header: {
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
  body: {
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
  primary: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    backgroundColor: colors.fg,
    borderRadius: radius.md,
  },
  primaryLabel: {
    color: colors.background,
    fontSize: 15,
    fontWeight: "600",
  },
  signOut: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  signOutLabel: {
    color: colors.faint,
    fontSize: 13.5,
    fontWeight: "500",
  },
  fineprint: {
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
