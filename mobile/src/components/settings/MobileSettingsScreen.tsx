import { Pressable, StyleSheet, Text, View } from "react-native";

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
  return (
    <MobileScreen contentStyle={styles.screenContent}>
      <View style={styles.profile}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{account.initials}</Text>
        </View>
        <View style={styles.profileText}>
          <Text style={styles.name} numberOfLines={1}>
            {account.name}
          </Text>
          <Text style={styles.handle} numberOfLines={1}>
            {account.handle}
          </Text>
        </View>
      </View>

      <Section label="Account">
        <MobileListRow
          leading={<RowIcon name="github" tint={colors.fg} />}
          title="GitHub"
          subtitle="Required for cloud sessions"
          trailing={
            <View style={styles.connected}>
              <MobileIcon name="check" size={12} color={colors.success} />
              <Text style={styles.connectedText}>Linked</Text>
            </View>
          }
        />
        <MobileListRow
          leading={<RowIcon name="shield" tint={colors.info} />}
          title="Two-factor authentication"
          subtitle="Required by your organization"
        />
      </Section>

      <Section label="Configure on web or desktop">
        <MobileListRow
          leading={<RowIcon name="cloud" tint={colors.faint} />}
          title="MCPs and skills"
          subtitle="Manage agent tools and skill bundles"
          trailing={<Lock />}
        />
        <MobileListRow
          leading={<RowIcon name="git-branch" tint={colors.faint} />}
          title="Workspaces and repos"
          subtitle="Add cloud workspaces or change repo access"
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
  connectedText: {
    color: colors.success,
    fontSize: 11.5,
    fontWeight: "600",
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
