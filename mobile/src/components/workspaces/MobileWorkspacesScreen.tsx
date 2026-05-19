import { StyleSheet, Text, View } from "react-native";

import type { ProductChat, ProductWorkspace } from "@proliferate/product-model/chats/model";
import { isTeamChat } from "@proliferate/product-model/chats/claiming";

import { MobileIcon } from "../primitives/MobileIcon";
import { MobileListRow } from "../primitives/MobileListRow";
import {
  MobileEmptyState,
  MobileScreen,
  MobileSectionLabel,
} from "../primitives/MobileLayout";
import { chats, workspaces } from "../../lib/fixtures/mobile-fixtures";
import { colors, radius, spacing } from "../../styles/tokens";

export function MobileWorkspacesScreen() {
  const shared = workspaces.filter((workspace) => workspace.kind === "shared");
  const personal = workspaces.filter((workspace) => workspace.kind !== "shared");

  return (
    <MobileScreen contentStyle={styles.screenContent}>
      {workspaces.length === 0 ? (
        <MobileEmptyState
          title="No workspaces yet"
          body="Create or join a workspace from the desktop app."
        />
      ) : (
        <View style={styles.stack}>
          <Section label="Shared" count={shared.length}>
            {shared.map((workspace) => (
              <WorkspaceRow key={workspace.id} workspace={workspace} />
            ))}
          </Section>
          <Section label="Personal" count={personal.length}>
            {personal.map((workspace) => (
              <WorkspaceRow key={workspace.id} workspace={workspace} />
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
  children: React.ReactNode;
}) {
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

function WorkspaceRow({ workspace }: { workspace: ProductWorkspace }) {
  const ws = workspace;
  const wsChats = chats.filter((c) => c.workspaceId === ws.id);
  const running = wsChats.filter((c) => c.status === "running").length;
  const unclaimed = wsChats.filter((c: ProductChat) => isTeamChat(c.kind) && !c.claimantUserId).length;

  return (
    <MobileListRow
      leading={
        <View style={styles.icon}>
          <MobileIcon
            name={ws.kind === "shared" ? "users" : "folder"}
            size={17}
            color={colors.mutedForeground}
          />
        </View>
      }
      title={ws.name}
      subtitle={`${ws.repoLabel} · ${ws.branchLabel}`}
      trailing={
        <View style={styles.trailing}>
          {unclaimed > 0 ? (
            <View style={styles.unclaimed}>
              <MobileIcon name="hand" size={11} color={colors.success} />
              <Text style={styles.unclaimedText}>{unclaimed}</Text>
            </View>
          ) : null}
          <Text style={styles.meta}>
            {wsChats.length} chat{wsChats.length === 1 ? "" : "s"}
            {running ? ` · ${running} running` : ""}
          </Text>
        </View>
      }
      showChevron
    />
  );
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
