import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  useAuthViewer,
  useCloudBilling,
  useCloudRepoConfigs,
  useOrganizations,
} from "@proliferate/cloud-sdk-react";

import { MobileIcon, type MobileIconName } from "../primitives/MobileIcon";
import { MobileListRow } from "../primitives/MobileListRow";
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
  const repoConfigs = useCloudRepoConfigs();
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

  return (
    <MobileScreen contentStyle={styles.screenContent}>
      <View style={styles.profile}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initialsFor(displayName)}</Text>
        </View>
        <View style={styles.profileText}>
          <Text style={styles.name} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.handle} numberOfLines={1}>
            {email}
          </Text>
        </View>
      </View>

      <Section label="Account">
        <MobileListRow
          leading={<RowIcon name="github" tint={colors.fg} />}
          title="GitHub"
          subtitle="Required for cloud sessions"
          trailing={
            <View style={[styles.connected, githubNeedsAttention && styles.warningChip]}>
              <MobileIcon
                name={githubConnected && !viewer.isError ? "check" : "external"}
                size={12}
                color={githubIconColor}
              />
              <Text style={[styles.connectedText, githubNeedsAttention && styles.warningText]}>
                {githubStateLabel}
              </Text>
            </View>
          }
        />
        <MobileListRow
          leading={<RowIcon name="shield" tint={colors.info} />}
          title="Auth state"
          subtitle={
            viewer.isError
              ? "Could not load account readiness"
              : viewer.isLoading
              ? "Checking account readiness..."
              : viewer.data?.onboardingState === "active"
                ? "Signed in and GitHub-linked"
                : "GitHub link required"
          }
        />
      </Section>

      <Section label="Cloud">
        <MobileListRow
          leading={<RowIcon name="cloud" tint={colors.faint} />}
          title="Personal plan"
          subtitle={billingSummary(billing.data, billing.isLoading, billing.isError)}
        />
        <MobileListRow
          leading={<RowIcon name="git-branch" tint={colors.faint} />}
          title="Configured repositories"
          subtitle={
            repoConfigs.isError
              ? "Could not load repository readiness"
              : repoConfigs.isLoading
              ? "Loading repo access..."
              : configuredRepos.length === 0
                ? "No personal cloud repos configured"
                : `${configuredRepos.length} ready for mobile new chat`
          }
        />
      </Section>

      <Section label="Teams">
        {organizations.isError ? (
          <MobileListRow
            leading={<RowIcon name="users" tint={colors.warning} />}
            title="Could not load teams"
            subtitle="Personal cloud workspaces are still available"
          />
        ) : organizations.isLoading ? (
          <MobileListRow
            leading={<RowIcon name="users" tint={colors.faint} />}
            title="Loading teams"
            subtitle="Checking organization memberships..."
          />
        ) : organizationRows.length === 0 ? (
          <MobileListRow
            leading={<RowIcon name="users" tint={colors.faint} />}
            title="No teams"
            subtitle="Personal cloud workspaces are still available"
          />
        ) : (
          organizationRows.map((organization) => (
            <MobileListRow
              key={organization.id}
              leading={<RowIcon name="users" tint={colors.info} />}
              title={organization.name}
              subtitle={organization.membership?.role
                ? `${organization.membership.role} access`
                : "Organization workspace"}
            />
          ))
        )}
      </Section>

      <Section label="Configure on web or desktop">
        <MobileListRow
          leading={<RowIcon name="settings" tint={colors.faint} />}
          title="MCPs, skills, and billing actions"
          subtitle="Advanced cloud setup still opens on Web or Desktop"
          trailing={<Lock />}
        />
      </Section>

      <View style={styles.signOutWrapper}>
        <Pressable
          accessibilityRole="button"
          onPress={onSignOut}
          style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}
        >
          <MobileIcon name="log-out" size={16} color={colors.destructive} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>

      <Text style={styles.footer}>Proliferate Mobile · build 0.1.0</Text>
    </MobileScreen>
  );
}

function billingSummary(
  plan: ReturnType<typeof useCloudBilling>["data"],
  loading: boolean,
  failed: boolean,
): string {
  if (loading && !plan) {
    return "Loading cloud plan...";
  }
  if (failed) {
    return "Could not load billing state";
  }
  if (!plan) {
    return "Cloud billing unavailable";
  }
  const hours = (
    plan.proBillingEnabled && plan.isPaidCloud
      ? plan.remainingManagedCloudHours
      : plan.remainingSandboxHours
  ) ?? null;
  const usage = hours === null || hours === undefined
    ? "unlimited runtime"
    : `${Math.max(0, Math.round(hours * 10) / 10)}h remaining`;
  const health = plan.startBlocked
    ? plan.startBlockReason ?? "starts blocked"
    : plan.paymentHealthy
      ? "ready"
      : "payment attention needed";
  return `${plan.plan} - ${usage} - ${health}`;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return initials || "P";
}

function RowIcon({ name, tint }: { name: MobileIconName; tint: string }) {
  return (
    <View style={styles.rowIcon}>
      <MobileIcon name={name} size={17} color={tint} />
    </View>
  );
}

function Lock() {
  return (
    <View style={styles.lockChip}>
      <MobileIcon name="lock" size={11} color={colors.faint} />
      <Text style={styles.lockText}>Web</Text>
    </View>
  );
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
      <View style={styles.list}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  profile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    padding: spacing[5],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.infoSubtle,
  },
  avatarText: {
    color: colors.info,
    fontSize: 16,
    fontWeight: "700",
  },
  profileText: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: colors.fg,
    fontSize: 17,
    fontWeight: "600",
  },
  handle: {
    color: colors.faint,
    fontSize: 13,
    marginTop: 2,
  },
  section: {
    marginTop: spacing[4],
  },
  sectionHeader: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[1],
  },
  list: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  rowIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  connected: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.successSubtle,
  },
  warningChip: {
    backgroundColor: colors.warningSubtle,
  },
  connectedText: {
    color: colors.success,
    fontSize: 11.5,
    fontWeight: "600",
  },
  warningText: {
    color: colors.warning,
  },
  lockChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  lockText: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  signOutWrapper: {
    paddingHorizontal: spacing[4],
    marginTop: spacing[5],
  },
  signOut: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.destructiveSubtle,
    backgroundColor: colors.destructiveSubtle,
  },
  signOutText: {
    color: colors.destructive,
    fontSize: 14,
    fontWeight: "600",
  },
  footer: {
    marginTop: spacing[4],
    color: colors.sidebarMutedForeground,
    fontSize: 11.5,
    textAlign: "center",
  },
  pressed: {
    opacity: 0.78,
  },
});
