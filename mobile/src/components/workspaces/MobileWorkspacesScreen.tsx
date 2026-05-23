import { StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";
import { useCloudWorkspaces } from "@proliferate/cloud-sdk-react";
import type { CloudWorkspaceSummary } from "@proliferate/cloud-sdk";

import { MobileIcon } from "../primitives/MobileIcon";
import { MobileListRow } from "../primitives/MobileListRow";
import {
  MobileEmptyState,
  MobileScreen,
  MobileSectionLabel,
} from "../primitives/MobileLayout";
import { colors, radius, spacing } from "../../styles/tokens";
import type { MobileCloudChat } from "../../navigation/navigation-model";

interface MobileWorkspacesScreenProps {
  onOpenChat: (chat: MobileCloudChat) => void;
}

export function MobileWorkspacesScreen({ onOpenChat }: MobileWorkspacesScreenProps) {
  const workspaces = useCloudWorkspaces({ scope: "my" });
  const shared = (workspaces.data ?? []).filter((workspace) => workspace.visibility !== "private");
  const personal = (workspaces.data ?? []).filter((workspace) => workspace.visibility === "private");

  return (
    <MobileScreen contentStyle={styles.screenContent}>
      {workspaces.isLoading ? (
        <MobileEmptyState title="Loading workspaces" body="Fetching cloud workspaces." />
      ) : workspaces.error ? (
        <MobileEmptyState
          title="Could not load workspaces"
          body="Refresh from Desktop or sign in again."
        />
      ) : (workspaces.data ?? []).length === 0 ? (
        <MobileEmptyState
          title="No cloud workspaces yet"
          body="Continue a workspace remotely from Desktop to see it here."
        />
      ) : (
        <View style={styles.stack}>
          <Section label="Shared" count={shared.length}>
            {shared.map((workspace) => (
              <WorkspaceRow
                key={workspace.id}
                workspace={workspace}
                onOpen={() => onOpenChat(cloudChatForWorkspace(workspace))}
              />
            ))}
          </Section>
          <Section label="Personal" count={personal.length}>
            {personal.map((workspace) => (
              <WorkspaceRow
                key={workspace.id}
                workspace={workspace}
                onOpen={() => onOpenChat(cloudChatForWorkspace(workspace))}
              />
            ))}
          </Section>
        </View>
      )}
    </MobileScreen>
  );
}

function Section({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) {
    return null;
  }
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <MobileSectionLabel>{label}</MobileSectionLabel>
        <Text style={styles.sectionCount}>{count}</Text>
      </View>
      <View style={styles.list}>{children}</View>
    </View>
  );
}

function WorkspaceRow({
  workspace,
  onOpen,
}: {
  workspace: CloudWorkspaceSummary;
  onOpen: () => void;
}) {
  const lastSession = workspace.lastSessionSummary;
  return (
    <MobileListRow
      leading={
        <View style={styles.icon}>
          <MobileIcon
            name={workspace.visibility === "private" ? "folder" : "users"}
            size={17}
            color={colors.mutedForeground}
          />
        </View>
      }
      title={workspace.displayName ?? workspace.repo.name}
      subtitle={`${workspace.repo.owner}/${workspace.repo.name} · ${
        workspace.repo.branch ?? workspace.repo.baseBranch ?? "main"
      }`}
      trailing={
        <View style={styles.trailing}>
          {workspace.visibility === "shared_unclaimed" ? (
            <View style={styles.unclaimed}>
              <MobileIcon name="hand" size={11} color={colors.success} />
              <Text style={styles.unclaimedText}>Claim</Text>
            </View>
          ) : null}
          <Text style={styles.meta}>
            {lastSession?.title ?? workspace.exposureState ?? workspace.status}
          </Text>
        </View>
      }
      showChevron
      onPress={onOpen}
    />
  );
}

function cloudChatForWorkspace(workspace: CloudWorkspaceSummary): MobileCloudChat {
  const session = workspace.lastSessionSummary;
  return {
    workspaceId: workspace.id,
    workspaceName: workspace.displayName ?? workspace.repo.name,
    repoLabel: `${workspace.repo.owner}/${workspace.repo.name}`,
    branchLabel: workspace.repo.branch ?? workspace.repo.baseBranch ?? "main",
    targetId: workspace.targetId ?? session?.targetId ?? null,
    workspaceRuntimeId: session?.workspaceId ?? null,
    sessionId: session?.sessionId ?? null,
    title: session?.title ?? workspace.displayName ?? workspace.repo.name,
    status: session?.status ?? workspace.workspaceStatus ?? workspace.status,
    visibility: workspace.visibility,
  };
}

const styles = StyleSheet.create({
  screenContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  stack: {
    gap: spacing[4],
  },
  section: {
    gap: spacing[1],
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[1],
  },
  sectionCount: {
    color: colors.faint,
    fontSize: 11.5,
    fontWeight: "500",
  },
  list: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight,
  },
  icon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  trailing: {
    alignItems: "flex-end",
    gap: 4,
  },
  meta: {
    color: colors.faint,
    fontSize: 11.5,
  },
  unclaimed: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.successSubtle,
  },
  unclaimedText: {
    color: colors.success,
    fontSize: 11,
    fontWeight: "600",
  },
});
