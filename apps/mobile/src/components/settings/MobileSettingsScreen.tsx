import { useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useMobileSettingsModel } from "../../hooks/settings/facade/use-mobile-settings-model";
import { useMobileBillingActions } from "../../hooks/settings/workflows/use-mobile-billing-actions";
import {
  billingHealthTone,
  billingHealthValue,
  billingPlanTitle,
  billingUsageLine,
  initialsForMobileSettingsName,
  mobileSectionLabels,
  type MobileSettingsAccountSummary,
} from "../../lib/domain/settings/mobile-settings-presentation";
import { MobileScreen } from "../primitives/MobileLayout";
import { MobileAddRepositoryModal } from "./screen/MobileAddRepositoryModal";
import {
  MobileSettingsRow,
  MobileSettingsSection,
} from "./screen/MobileSettingsSection";
import { colors, spacing } from "../../styles/tokens";

interface MobileSettingsScreenProps {
  account: MobileSettingsAccountSummary;
  onSignOut: () => void;
}

export function MobileSettingsScreen({ account, onSignOut }: MobileSettingsScreenProps) {
  const settingsModel = useMobileSettingsModel(account);
  const billingWorkflow = useMobileBillingActions();
  const [addRepoOpen, setAddRepoOpen] = useState(false);
  const configuredRepoKeys = useMemo(
    () => new Set(settingsModel.configuredRepos.map((repo) => `${repo.gitOwner}/${repo.gitRepoName}`)),
    [settingsModel.configuredRepos],
  );
  const sectionLabels = mobileSectionLabels();

  return (
    <MobileScreen contentStyle={styles.screenContent}>
      <View style={styles.profile}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initialsForMobileSettingsName(settingsModel.displayName)}</Text>
        </View>
        <Text style={styles.name} numberOfLines={1}>
          {settingsModel.displayName}
        </Text>
        <Text style={styles.handle} numberOfLines={1}>
          {settingsModel.email}
        </Text>
      </View>

      <MobileSettingsSection label={sectionLabels.account}>
        <MobileSettingsRow
          icon="github"
          title="GitHub"
          value={settingsModel.githubStateLabel}
          valueTone={
            settingsModel.githubNeedsAttention
              ? "warning"
              : settingsModel.githubConnected ? "success" : "muted"
          }
        />
        <MobileSettingsRow
          icon="lock"
          title="Email/password"
          value={settingsModel.passwordStateLabel}
          valueTone={settingsModel.passwordEnabled ? "success" : "muted"}
        />
        <MobileSettingsRow
          icon="shield"
          title="Auth"
          value={settingsModel.authStateLabel}
          valueTone="muted"
        />
      </MobileSettingsSection>

      <MobileSettingsSection label={sectionLabels.environments}>
        {settingsModel.configuredRepos.length === 0 && !settingsModel.repoConfigs.isLoading ? (
          <MobileSettingsRow icon="git-branch" title="No repositories yet" subtitle="Add one to launch mobile chats" />
        ) : (
          settingsModel.configuredRepos.map((repo) => (
            <MobileSettingsRow
              key={`${repo.gitOwner}/${repo.gitRepoName}`}
              icon="git-branch"
              title={`${repo.gitOwner}/${repo.gitRepoName}`}
              subtitle="Configured"
            />
          ))
        )}
        {settingsModel.repoConfigs.isLoading && settingsModel.configuredRepos.length === 0 ? (
          <MobileSettingsRow icon="git-branch" title="Loading repositories" />
        ) : null}
        <MobileSettingsRow
          icon="plus"
          title="Add repository"
          subtitle="Pick from your GitHub repos"
          onPress={() => setAddRepoOpen(true)}
          chevron
        />
      </MobileSettingsSection>

      <MobileSettingsSection label={sectionLabels.organization}>
        {settingsModel.organizations.isError ? (
          <MobileSettingsRow icon="users" title="Teams" value="Error" valueTone="warning" />
        ) : settingsModel.organizations.isLoading ? (
          <MobileSettingsRow icon="users" title="Teams" value="Loading" valueTone="muted" />
        ) : settingsModel.organizationRows.length === 0 ? (
          <MobileSettingsRow icon="users" title="Teams" value="None" valueTone="muted" />
        ) : (
          settingsModel.organizationRows.map((organization) => (
            <MobileSettingsRow
              key={organization.id}
              icon="users"
              title={organization.name}
              value={organization.membership?.role ?? "Member"}
              valueTone="muted"
            />
          ))
        )}
      </MobileSettingsSection>

      <MobileSettingsSection label={sectionLabels.billing}>
        <MobileSettingsRow
          icon="cloud"
          title={billingPlanTitle(
            settingsModel.billing.data,
            settingsModel.billing.isLoading,
            settingsModel.billing.isError,
          )}
          subtitle={billingUsageLine(
            settingsModel.billing.data,
            settingsModel.billing.isLoading,
            settingsModel.billing.isError,
          )}
          value={billingHealthValue(settingsModel.billing.data)}
          valueTone={billingHealthTone(settingsModel.billing.data)}
        />
        {settingsModel.billing.data?.isPaidCloud ? (
          <MobileSettingsRow
            icon="external"
            title="Manage billing"
            subtitle={billingWorkflow.billingActions.creatingBillingPortal ? "Opening..." : "Stripe portal"}
            onPress={() => void billingWorkflow.startBillingAction("portal")}
            chevron
          />
        ) : settingsModel.billing.data ? (
          <MobileSettingsRow
            icon="sparkles"
            title="Upgrade"
            subtitle={billingWorkflow.billingActions.creatingCloudCheckout ? "Opening..." : "Get paid cloud runtime"}
            onPress={() => void billingWorkflow.startBillingAction("checkout")}
            chevron
          />
        ) : null}
        {settingsModel.billing.data?.isPaidCloud
          && !settingsModel.billing.data.proBillingEnabled
          && !settingsModel.billing.data.hasUnlimitedCloudHours ? (
            <MobileSettingsRow
              icon="cloud"
              title="Refill 10h"
              subtitle={billingWorkflow.billingActions.creatingRefillCheckout ? "Opening..." : "One-time top up"}
              onPress={() => void billingWorkflow.startBillingAction("refill")}
              chevron
            />
          ) : null}
        {billingWorkflow.billingError ? (
          <MobileSettingsRow icon="lock" title={billingWorkflow.billingError} valueTone="warning" />
        ) : null}
      </MobileSettingsSection>

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

      <MobileAddRepositoryModal
        visible={addRepoOpen}
        configuredKeys={configuredRepoKeys}
        onClose={() => setAddRepoOpen(false)}
        onSaved={() => void settingsModel.repoConfigs.refetch()}
      />
    </MobileScreen>
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
});
