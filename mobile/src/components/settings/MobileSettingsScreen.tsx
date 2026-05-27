import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  useAuthViewer,
  useCloudBilling,
  useCloudBillingActions,
  useCloudGitRepositories,
  useCloudRepoConfigs,
  useOrganizations,
  useSaveCloudRepoConfig,
} from "@proliferate/cloud-sdk-react";
import { mobileCloudSettingsSections } from "@proliferate/product-model/settings/cloud-settings";

import { MobileIcon, type MobileIconName } from "../primitives/MobileIcon";
import {
  MobileScreen,
  MobileSectionLabel,
} from "../primitives/MobileLayout";
import { colors, radius, spacing } from "../../styles/tokens";

interface AccountSummary {
  initials: string;
  name: string;
  handle: string;
}

interface MobileSettingsScreenProps {
  account: AccountSummary;
  onSignOut: () => void;
}

export function MobileSettingsScreen({ account, onSignOut }: MobileSettingsScreenProps) {
  const viewer = useAuthViewer();
  const organizations = useOrganizations();
  const billing = useCloudBilling({ ownerScope: "personal" });
  const billingActions = useCloudBillingActions({ ownerScope: "personal" });
  const repoConfigs = useCloudRepoConfigs();
  const [addRepoOpen, setAddRepoOpen] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);

  async function handleBillingAction(action: "portal" | "checkout" | "refill") {
    setBillingError(null);
    try {
      const response =
        action === "portal"
          ? await billingActions.createBillingPortal()
          : action === "refill"
            ? await billingActions.createRefillCheckout()
            : await billingActions.createCloudCheckout();
      await Linking.openURL(response.url);
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "Billing action could not start.");
    }
  }
  const displayName =
    viewer.data?.user.display_name?.trim()
    || viewer.data?.user.email?.split("@")[0]
    || account.name;
  const email = viewer.data?.user.email ?? account.handle;
  const githubConnected = Boolean(viewer.data?.githubConnected);
  const githubChecking = viewer.isLoading && !viewer.data;
  const githubStateLabel = githubChecking
    ? "Checking"
    : viewer.isError
    ? "Unknown"
    : githubConnected
      ? "Linked"
      : "Required";
  const githubNeedsAttention = !githubChecking && (viewer.isError || !githubConnected);
  const githubIconColor = githubChecking
    ? colors.faint
    : githubConnected && !viewer.isError
      ? colors.success
      : colors.warning;
  const configuredRepos = (repoConfigs.data?.configs ?? []).filter((repo) => repo.configured);
  const organizationRows = organizations.data?.organizations ?? [];
  const sectionLabels = mobileSectionLabels();

  return (
    <MobileScreen contentStyle={styles.screenContent}>
      <View style={styles.profile}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initialsFor(displayName)}</Text>
        </View>
        <Text style={styles.name} numberOfLines={1}>
          {displayName}
        </Text>
        <Text style={styles.handle} numberOfLines={1}>
          {email}
        </Text>
      </View>

      <Section label={sectionLabels.account}>
        <SettingsRow
          icon="github"
          title="GitHub"
          value={githubStateLabel}
          valueTone={githubNeedsAttention ? "warning" : githubConnected ? "success" : "muted"}
        />
        <SettingsRow
          icon="shield"
          title="Auth"
          value={
            viewer.isError
              ? "Unknown"
              : viewer.isLoading
              ? "Checking"
              : viewer.data?.onboardingState === "active"
                ? "Active"
                : "Setup"
          }
          valueTone="muted"
        />
      </Section>

      <Section label={sectionLabels.environments}>
        {configuredRepos.length === 0 && !repoConfigs.isLoading ? (
          <SettingsRow icon="git-branch" title="No repositories yet" subtitle="Add one to launch mobile chats" />
        ) : (
          configuredRepos.map((repo) => (
            <SettingsRow
              key={`${repo.gitOwner}/${repo.gitRepoName}`}
              icon="git-branch"
              title={`${repo.gitOwner}/${repo.gitRepoName}`}
              subtitle="Configured"
            />
          ))
        )}
        {repoConfigs.isLoading && configuredRepos.length === 0 ? (
          <SettingsRow icon="git-branch" title="Loading repositories" />
        ) : null}
        <SettingsRow
          icon="plus"
          title="Add repository"
          subtitle="Pick from your GitHub repos"
          onPress={() => setAddRepoOpen(true)}
          chevron
        />
      </Section>

      <Section label={sectionLabels.organization}>
        {organizations.isError ? (
          <SettingsRow icon="users" title="Teams" value="Error" valueTone="warning" />
        ) : organizations.isLoading ? (
          <SettingsRow icon="users" title="Teams" value="Loading" valueTone="muted" />
        ) : organizationRows.length === 0 ? (
          <SettingsRow icon="users" title="Teams" value="None" valueTone="muted" />
        ) : (
          organizationRows.map((organization) => (
            <SettingsRow
              key={organization.id}
              icon="users"
              title={organization.name}
              value={organization.membership?.role ?? "Member"}
              valueTone="muted"
            />
          ))
        )}
      </Section>

      <Section label={sectionLabels.billing}>
        <SettingsRow
          icon="cloud"
          title={billingPlanTitle(billing.data, billing.isLoading, billing.isError)}
          subtitle={billingUsageLine(billing.data, billing.isLoading, billing.isError)}
          value={billingHealthValue(billing.data)}
          valueTone={billingHealthTone(billing.data)}
        />
        {billing.data?.isPaidCloud ? (
          <SettingsRow
            icon="external"
            title="Manage billing"
            subtitle={billingActions.creatingBillingPortal ? "Opening..." : "Stripe portal"}
            onPress={() => void handleBillingAction("portal")}
            chevron
          />
        ) : billing.data ? (
          <SettingsRow
            icon="sparkles"
            title="Upgrade"
            subtitle={billingActions.creatingCloudCheckout ? "Opening..." : "Get paid cloud runtime"}
            onPress={() => void handleBillingAction("checkout")}
            chevron
          />
        ) : null}
        {billing.data?.isPaidCloud
          && !billing.data.proBillingEnabled
          && !billing.data.hasUnlimitedCloudHours ? (
            <SettingsRow
              icon="cloud"
              title="Refill 10h"
              subtitle={billingActions.creatingRefillCheckout ? "Opening..." : "One-time top up"}
              onPress={() => void handleBillingAction("refill")}
              chevron
            />
          ) : null}
        {billingError ? (
          <SettingsRow icon="lock" title={billingError} valueTone="warning" />
        ) : null}
      </Section>

      <View style={styles.signOutWrapper}>
        <Pressable
          accessibilityRole="button"
          onPress={onSignOut}
          style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>

      <Text style={styles.footer}>Proliferate · 0.1.0</Text>

      <AddRepositoryModal
        visible={addRepoOpen}
        configuredKeys={new Set(configuredRepos.map((r) => `${r.gitOwner}/${r.gitRepoName}`))}
        onClose={() => setAddRepoOpen(false)}
        onSaved={() => void repoConfigs.refetch()}
      />
    </MobileScreen>
  );
}

function AddRepositoryModal({
  visible,
  configuredKeys,
  onClose,
  onSaved,
}: {
  visible: boolean;
  configuredKeys: Set<string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const repos = useCloudGitRepositories({}, visible);
  const save = useSaveCloudRepoConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const slideUp = useSheetSlide(visible);

  const available = useMemo(() => {
    const all = (repos.data?.repositories ?? []).filter(
      (r) => !configuredKeys.has(`${r.gitOwner}/${r.gitRepoName}`),
    );
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [repos.data, configuredKeys, query]);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setError(null);
    }
  }, [visible]);

  async function pick(gitOwner: string, gitRepoName: string, defaultBranch: string | null) {
    const key = `${gitOwner}/${gitRepoName}`;
    setBusyKey(key);
    setError(null);
    try {
      await save.mutateAsync({
        gitOwner,
        gitRepoName,
        body: {
          configured: true,
          defaultBranch,
          envVars: {},
          setupScript: "",
          runCommand: "",
        },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save repository.");
    } finally {
      setBusyKey(null);
    }
  }

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
              value={query}
              onChangeText={setQuery}
              placeholder="Search your repositories"
              placeholderTextColor={colors.faint}
              autoCorrect={false}
              autoCapitalize="none"
              style={styles.searchInput}
            />
            {query ? (
              <Pressable accessibilityRole="button" onPress={() => setQuery("")}>
                <MobileIcon name="close" size={14} color={colors.faint} />
              </Pressable>
            ) : null}
          </View>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            {repos.isLoading ? (
              <View style={styles.modalEmpty}>
                <ActivityIndicator color={colors.faint} />
                <Text style={styles.modalEmptyText}>Loading your GitHub repos…</Text>
              </View>
            ) : repos.isError ? (
              <Text style={styles.modalEmptyText}>Could not load repositories.</Text>
            ) : available.length === 0 ? (
              <Text style={styles.modalEmptyText}>
                {query ? "No matches." : "All your repos are already configured."}
              </Text>
            ) : (
              available.map((r) => {
                const key = `${r.gitOwner}/${r.gitRepoName}`;
                const busy = busyKey === key;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    disabled={Boolean(busyKey)}
                    onPress={() => void pick(r.gitOwner, r.gitRepoName, r.defaultBranch ?? null)}
                    style={({ pressed }) => [
                      styles.repoRow,
                      pressed && styles.rowPressed,
                      busy && styles.repoRowBusy,
                    ]}
                  >
                    <MobileIcon name="git-branch" size={17} color={colors.fg} />
                    <View style={styles.repoText}>
                      <Text style={styles.repoTitle} numberOfLines={1}>{r.fullName}</Text>
                      {r.defaultBranch ? (
                        <Text style={styles.repoSubtitle} numberOfLines={1}>{r.defaultBranch}</Text>
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
            {error ? <Text style={styles.modalErrorText}>{error}</Text> : null}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function useSheetSlide(visible: boolean) {
  const screenH = Dimensions.get("window").height;
  const value = useRef(new Animated.Value(screenH)).current;
  useEffect(() => {
    Animated.timing(value, {
      toValue: visible ? 0 : screenH,
      duration: visible ? 280 : 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [visible, value, screenH]);
  return value;
}

function SettingsRow({
  icon,
  title,
  subtitle,
  value,
  valueTone = "muted",
  trailing,
  chevron,
  onPress,
}: {
  icon: MobileIconName;
  title: string;
  subtitle?: string;
  value?: string;
  valueTone?: "muted" | "success" | "warning";
  trailing?: React.ReactNode;
  chevron?: boolean;
  onPress?: () => void;
}) {
  const valueColor =
    valueTone === "success" ? colors.success : valueTone === "warning" ? colors.warning : colors.faint;
  const content = (
    <>
      <MobileIcon name={icon} size={18} color={colors.fg} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[styles.rowValue, { color: valueColor }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {chevron ? (
        <MobileIcon name="chevron-right" size={15} color={colors.faint} />
      ) : null}
    </>
  );
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        {content}
      </Pressable>
    );
  }
  return <View style={styles.row}>{content}</View>;
}


function mobileSectionLabels(): Record<"account" | "environments" | "organization" | "billing", string> {
  const labels = new Map(
    mobileCloudSettingsSections().map((section) => [section.id, section.label]),
  );
  return {
    account: labels.get("account") ?? "Account",
    environments: labels.get("environments") ?? "Environments",
    organization: labels.get("organization") ?? "Organization",
    billing: labels.get("billing") ?? "Billing",
  };
}

function billingPlanTitle(
  plan: ReturnType<typeof useCloudBilling>["data"],
  loading: boolean,
  failed: boolean,
): string {
  if (failed) return "Plan";
  if (loading && !plan) return "Plan";
  if (!plan) return "Plan";
  return planLabel(plan.plan);
}

function billingUsageLine(
  plan: ReturnType<typeof useCloudBilling>["data"],
  loading: boolean,
  failed: boolean,
): string {
  if (failed) return "Could not load billing";
  if (loading && !plan) return "Loading";
  if (!plan) return "Unavailable";
  const hours = (
    plan.proBillingEnabled && plan.isPaidCloud
      ? plan.remainingManagedCloudHours
      : plan.remainingSandboxHours
  ) ?? null;
  if (hours === null || hours === undefined) return "Unlimited runtime";
  return `${Math.max(0, Math.round(hours * 10) / 10)}h remaining`;
}

function billingHealthValue(
  plan: ReturnType<typeof useCloudBilling>["data"],
): string | undefined {
  if (!plan) return undefined;
  if (plan.startBlocked) return "Blocked";
  if (!plan.paymentHealthy) return "Attention";
  return undefined;
}

function billingHealthTone(
  plan: ReturnType<typeof useCloudBilling>["data"],
): "muted" | "success" | "warning" {
  if (!plan) return "muted";
  if (plan.startBlocked) return "warning";
  if (!plan.paymentHealthy) return "warning";
  return "muted";
}

function planLabel(plan: string): string {
  const trimmed = plan?.trim();
  if (!trimmed) return "Plan";
  return trimmed
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return initials || "P";
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <MobileSectionLabel>{label}</MobileSectionLabel>
      </View>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[6],
  },
  profile: {
    alignItems: "center",
    paddingVertical: spacing[5],
    gap: spacing[2],
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: spacing[2],
  },
  avatarText: {
    color: colors.fg,
    fontSize: 20,
    fontWeight: "600",
  },
  name: {
    color: colors.fg,
    fontSize: 18,
    fontWeight: "600",
  },
  handle: {
    color: colors.faint,
    fontSize: 13.5,
  },
  section: {
    marginTop: spacing[4],
  },
  sectionHeader: {
    paddingHorizontal: spacing[3],
    paddingBottom: 6,
  },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  rowPressed: {
    backgroundColor: colors.accent,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  rowTitle: {
    color: colors.fg,
    fontSize: 14.5,
    fontWeight: "500",
  },
  rowSubtitle: {
    color: colors.faint,
    fontSize: 12,
  },
  rowValue: {
    fontSize: 13,
    fontWeight: "500",
  },
  signOutWrapper: {
    marginTop: spacing[5],
  },
  signOut: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  signOutText: {
    color: colors.destructive,
    fontSize: 14.5,
    fontWeight: "500",
  },
  footer: {
    marginTop: spacing[4],
    color: colors.faint,
    fontSize: 11,
    textAlign: "center",
  },
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
