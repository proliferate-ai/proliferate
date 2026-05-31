import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { AuthProviderName } from "@proliferate/cloud-sdk";
import {
  AUTH_PROVIDER_ORDER,
  AUTH_PASSWORD_COPY,
  AUTH_SIGN_IN_COPY,
  authProviderPresentation,
} from "@proliferate/product-domain/auth/presentation";

import { MobileIcon, type MobileIconName } from "../primitives/MobileIcon";
import { MobileProliferateMark } from "../primitives/MobileProliferateMark";
import { colors, radius, spacing } from "../../styles/tokens";
import type { MobileAuthAction } from "../../providers/MobileAuthProvider";

interface MobileAuthScreenProps {
  onProvider: (provider: AuthProviderName) => void;
  onPassword: (email: string, password: string) => void;
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
  onPassword,
  loadingAction,
  error,
}: MobileAuthScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const busy = Boolean(loadingAction);
  const passwordSubmitting = loadingAction === "password";
  const passwordDisabled = busy || !email.trim() || !password;

  function submitPassword() {
    if (!passwordDisabled) {
      onPassword(email, password);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <View style={styles.brand}>
            <MobileProliferateMark size={40} />
            <Text style={styles.title}>{AUTH_SIGN_IN_COPY.title}</Text>
            <Text style={styles.subtitle}>{AUTH_SIGN_IN_COPY.subtitle}</Text>
          </View>

          <View style={styles.passwordForm}>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{AUTH_PASSWORD_COPY.emailLabel}</Text>
              <TextInput
                accessibilityLabel={AUTH_PASSWORD_COPY.emailLabel}
                value={email}
                onChangeText={setEmail}
                editable={!busy}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                returnKeyType="next"
                textContentType="username"
                placeholder={AUTH_PASSWORD_COPY.emailPlaceholder}
                placeholderTextColor={colors.faint}
                style={styles.input}
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{AUTH_PASSWORD_COPY.passwordLabel}</Text>
              <TextInput
                accessibilityLabel={AUTH_PASSWORD_COPY.passwordLabel}
                value={password}
                onChangeText={setPassword}
                editable={!busy}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                returnKeyType="go"
                textContentType="password"
                placeholder={AUTH_PASSWORD_COPY.passwordPlaceholder}
                placeholderTextColor={colors.faint}
                secureTextEntry
                style={styles.input}
                onSubmitEditing={submitPassword}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={AUTH_PASSWORD_COPY.submitLabel}
              accessibilityState={{ disabled: passwordDisabled }}
              disabled={passwordDisabled}
              onPress={submitPassword}
              style={({ pressed }) => [
                styles.passwordButton,
                pressed && !busy && styles.pressed,
                passwordDisabled && styles.disabled,
              ]}
            >
              {passwordSubmitting ? (
                <ActivityIndicator size="small" color={colors.background} />
              ) : null}
              <Text style={styles.passwordButtonLabel}>
                {passwordSubmitting ? AUTH_PASSWORD_COPY.busyLabel : AUTH_PASSWORD_COPY.submitLabel}
              </Text>
            </Pressable>
          </View>

          <View style={styles.divider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={styles.dividerLine} />
            <Text style={styles.dividerLabel}>or</Text>
            <View style={styles.dividerLine} />
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

          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
        </View>

        <Text style={styles.legal}>{AUTH_SIGN_IN_COPY.footer}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
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
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing[6],
    paddingTop: spacing[12],
    paddingBottom: spacing[8],
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
    marginTop: spacing[4],
  },
  passwordForm: {
    alignSelf: "stretch",
    gap: spacing[3],
    marginTop: spacing[8],
  },
  fieldGroup: {
    gap: spacing[1],
  },
  fieldLabel: {
    color: colors.mutedForeground,
    fontSize: 12,
    fontWeight: "600",
  },
  input: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.fg,
    fontSize: 15,
    paddingHorizontal: 12,
  },
  passwordButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.fg,
  },
  passwordButtonLabel: {
    color: colors.background,
    fontSize: 15,
    fontWeight: "600",
  },
  divider: {
    marginTop: spacing[5],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  dividerLabel: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
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
