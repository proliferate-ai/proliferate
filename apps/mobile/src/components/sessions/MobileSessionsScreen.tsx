import { StyleSheet, Text, View } from "react-native";
import {
  useCloudWorkspaceSnapshot,
  useCloudWorkspaces,
} from "@proliferate/cloud-sdk-react";
import type {
  CloudSessionProjection,
  CloudWorkspaceSummary,
} from "@proliferate/cloud-sdk";

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
  const workspaceRows = workspaces.data ?? [];
  const projectedSessionCount = workspaceRows.reduce(
    (count, workspace) => count + (workspace.lastSessionSummary ? 1 : 0),
    0,
  );

  return (
    <MobileScreen contentStyle={styles.screenContent}>
      {workspaces.isLoading ? (
        <MobileEmptyState title="Loading sessions" body="Fetching projected cloud sessions." />
      ) : workspaces.error ? (
        <MobileEmptyState title="Could not load sessions" body="Refresh or sign in again." />
      ) : projectedSessionCount === 0 ? (
        <MobileEmptyState
          title="No projected sessions"
          body="Cloud sessions appear here after a workspace has live projection."
        />
      ) : (
        <View style={styles.list}>
          {workspaceRows.map((workspace) => (
            <WorkspaceSessionRows
              key={workspace.id}
              workspace={workspace}
              onOpenChat={onOpenChat}
            />
          ))}
        </View>
      )}
    </MobileScreen>
  );
}

function WorkspaceSessionRows({
  workspace,
  onOpenChat,
}: {
  workspace: CloudWorkspaceSummary;
  onOpenChat: (chat: MobileCloudChat) => void;
}) {
  const snapshot = useCloudWorkspaceSnapshot(workspace.id, Boolean(workspace.lastSessionSummary));
  const sessions = snapshot.data?.sessions.length
    ? [...snapshot.data.sessions].sort(compareSessions)
    : workspace.lastSessionSummary
      ? [sessionProjectionFromSummary(workspace)]
      : [];

  return (
    <>
      {sessions.map((session) => {
        const chat = cloudChatForSession(workspace, session);
        return (
          <SessionRow
            key={`${workspace.id}:${session.sessionId}`}
            chat={chat}
            onPress={() => onOpenChat(chat)}
          />
        );
      })}
    </>
  );
}

function SessionRow({ chat, onPress }: { chat: MobileCloudChat; onPress: () => void }) {
  const unclaimed = chat.visibility === "shared_unclaimed";

  return (
    <MobileListRow
      onPress={onPress}
      leading={<MobileKindIcon kind={unclaimed ? "shared-chat" : "cloud"} />}
      title={chat.title}
      subtitle={`${chat.workspaceName} · ${chat.repoLabel} · ${shortSessionLabel(chat.sessionId)}`}
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

function cloudChatForSession(
  workspace: CloudWorkspaceSummary,
  session: Pick<
    CloudSessionProjection,
    "sessionId" | "targetId" | "workspaceId" | "title" | "status"
  >,
): MobileCloudChat {
  const workspaceName = workspace.displayName ?? workspace.repo.name;
  return {
    workspaceId: workspace.id,
    workspaceName,
    repoLabel: `${workspace.repo.owner}/${workspace.repo.name}`,
    branchLabel: workspace.repo.branch ?? workspace.repo.baseBranch ?? "main",
    targetId: session.targetId ?? workspace.targetId ?? null,
    workspaceRuntimeId: session.workspaceId ?? null,
    sessionId: session.sessionId,
    title: session.title ?? workspaceName,
    status: session.status ?? workspace.workspaceStatus ?? workspace.status,
    visibility: workspace.visibility,
  };
}

function sessionProjectionFromSummary(
  workspace: CloudWorkspaceSummary,
): Pick<
  CloudSessionProjection,
  "sessionId" | "targetId" | "workspaceId" | "title" | "status" | "lastEventSeq"
> & SessionRecencyFields {
  const session = workspace.lastSessionSummary;
  if (!session) {
    throw new Error("Cannot build a session row without a workspace session summary.");
  }
  return {
    sessionId: session.sessionId,
    targetId: session.targetId,
    workspaceId: session.workspaceId ?? workspace.anyharnessWorkspaceId ?? workspace.id,
    title: session.title ?? workspace.displayName ?? workspace.repo.name,
    status: session.status,
    lastEventSeq: 0,
    lastEventAt: session.lastEventAt ?? null,
  };
}

function compareSessions(
  left: SessionRecencyFields,
  right: SessionRecencyFields,
): number {
  return sessionRecencyMs(right) - sessionRecencyMs(left)
    || (right.lastEventSeq ?? 0) - (left.lastEventSeq ?? 0);
}

function sessionRecencyMs(
  session: SessionRecencyFields,
): number {
  return Date.parse(session.lastEventAt ?? session.startedAt ?? "") || 0;
}

interface SessionRecencyFields {
  lastEventAt?: string | null;
  startedAt?: string | null;
  lastEventSeq?: number | null;
}

function shortSessionLabel(sessionId: string | null): string {
  return sessionId ? `session ${sessionId.slice(0, 8)}` : "new session";
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
