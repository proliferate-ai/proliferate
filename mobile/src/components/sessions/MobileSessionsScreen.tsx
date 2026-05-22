import { StyleSheet, Text, View } from "react-native";
import { useCloudWorkspaces } from "@proliferate/cloud-sdk-react";
import type { CloudWorkspaceSummary } from "@proliferate/cloud-sdk";

import { MobileIcon } from "../primitives/MobileIcon";
import { MobileKindIcon } from "../primitives/MobileKindIcon";
import { MobileListRow } from "../primitives/MobileListRow";
import { MobileEmptyState, MobileScreen } from "../primitives/MobileLayout";
import { MobileStatusDot } from "../primitives/MobileStatusDot";
import type { MobileCloudChat } from "../../navigation/navigation-model";
import { colors, radius, spacing } from "../../styles/tokens";

interface MobileSessionsScreenProps {
  onOpenChat: (chat: MobileCloudChat) => void;
}

export function MobileSessionsScreen({ onOpenChat }: MobileSessionsScreenProps) {
  const workspaces = useCloudWorkspaces({ scope: "my" });
  const chats = (workspaces.data ?? []).flatMap(cloudChatsForWorkspace);

  return (
    <MobileScreen contentStyle={styles.screenContent}>
      {workspaces.isLoading ? (
        <MobileEmptyState title="Loading sessions" body="Fetching projected cloud sessions." />
      ) : workspaces.error ? (
        <MobileEmptyState title="Could not load sessions" body="Refresh or sign in again." />
      ) : chats.length === 0 ? (
        <MobileEmptyState
          title="No projected sessions"
          body="Cloud sessions appear here after a workspace has live projection."
        />
      ) : (
        <View style={styles.list}>
          {chats.map((chat) => (
            <SessionRow
              key={`${chat.workspaceId}:${chat.sessionId}`}
              chat={chat}
              onPress={() => onOpenChat(chat)}
            />
          ))}
        </View>
      )}
    </MobileScreen>
  );
}

function SessionRow({ chat, onPress }: { chat: MobileCloudChat; onPress: () => void }) {
  const unclaimed = chat.visibility === "shared_unclaimed";

  return (
    <MobileListRow
      onPress={onPress}
      leading={<MobileKindIcon kind={unclaimed ? "shared-chat" : "cloud"} />}
      title={chat.title}
      subtitle={`${chat.workspaceName} · ${chat.repoLabel}`}
      trailing={
        <View style={styles.trailing}>
          {unclaimed ? (
            <View style={styles.claim}>
              <MobileIcon name="hand" size={11} color={colors.success} />
              <Text style={styles.claimText}>Claim</Text>
            </View>
          ) : null}
          <View style={styles.statusGroup}>
            <MobileStatusDot status={mobileStatus(chat.status)} />
            <Text style={styles.statusText}>{chat.status}</Text>
          </View>
        </View>
      }
    />
  );
}

function cloudChatsForWorkspace(workspace: CloudWorkspaceSummary): MobileCloudChat[] {
  const session = workspace.lastSessionSummary;
  if (!session) {
    return [];
  }
  return [
    {
      workspaceId: workspace.id,
      workspaceName: workspace.displayName ?? workspace.repo.name,
      repoLabel: `${workspace.repo.owner}/${workspace.repo.name}`,
      branchLabel: workspace.repo.branch ?? workspace.repo.baseBranch ?? "main",
      targetId: session.targetId,
      workspaceRuntimeId: session.workspaceId ?? null,
      sessionId: session.sessionId,
      title: session.title ?? workspace.displayName ?? workspace.repo.name,
      status: session.status,
      visibility: workspace.visibility,
    },
  ];
}

function mobileStatus(status: string): "running" | "idle" | "paused" | "failed" | "done" {
  if (status === "running") {
    return "running";
  }
  if (status === "failed" || status === "error") {
    return "failed";
  }
  if (status === "paused") {
    return "paused";
  }
  if (status === "ended" || status === "done" || status === "completed") {
    return "done";
  }
  return "idle";
}

const styles = StyleSheet.create({
  screenContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  list: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight,
  },
  trailing: {
    alignItems: "flex-end",
    gap: 4,
  },
  statusGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusText: {
    color: colors.faint,
    fontSize: 11.5,
  },
  claim: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.successSubtle,
  },
  claimText: {
    color: colors.success,
    fontSize: 11,
    fontWeight: "600",
  },
});
