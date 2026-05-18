import { StyleSheet, Text, View } from "react-native";

import { deriveClaimState, isTeamChat } from "@proliferate/product-model/chats/claiming";
import { chatKindPresentation } from "@proliferate/product-model/chats/presentation";
import type { ProductChat } from "@proliferate/product-model/chats/model";

import { MobileIcon } from "../primitives/MobileIcon";
import { MobileKindIcon } from "../primitives/MobileKindIcon";
import { MobileListRow } from "../primitives/MobileListRow";
import { MobileScreen } from "../primitives/MobileLayout";
import { MobileStatusDot } from "../primitives/MobileStatusDot";
import { chats, currentUser, workspaceForChat } from "../../lib/fixtures/mobile-fixtures";
import { colors, radius, spacing } from "../../styles/tokens";

interface MobileSessionsScreenProps {
  onOpenChat: (chat: ProductChat) => void;
}

export function MobileSessionsScreen({ onOpenChat }: MobileSessionsScreenProps) {
  return (
    <MobileScreen contentStyle={styles.screenContent}>
      <View style={styles.list}>
        {chats.map((chat) => (
          <SessionRow
            key={chat.id}
            chat={chat}
            onPress={() => onOpenChat(chat)}
          />
        ))}
      </View>
    </MobileScreen>
  );
}

function SessionRow({ chat, onPress }: { chat: ProductChat; onPress: () => void }) {
  const presentation = chatKindPresentation(chat.kind);
  const workspace = workspaceForChat(chat);
  const claim = deriveClaimState(chat, currentUser);
  const unclaimed = isTeamChat(chat.kind) && claim.kind === "unclaimed";

  return (
    <MobileListRow
      onPress={onPress}
      leading={<MobileKindIcon kind={chat.kind} />}
      title={chat.title}
      subtitle={`${presentation.label} · ${workspace?.name ?? "Unknown"}${
        claim.kind === "claimed_by_other" ? ` · ${claim.claimantName}` : ""
      }`}
      trailing={
        <View style={styles.trailing}>
          {unclaimed ? (
            <View style={styles.claim}>
              <MobileIcon name="hand" size={11} color={colors.success} />
              <Text style={styles.claimText}>Claim</Text>
            </View>
          ) : null}
          <View style={styles.statusGroup}>
            <MobileStatusDot status={chat.status} />
            <Text style={styles.statusText}>{chatStatusLabel(chat.status)}</Text>
          </View>
        </View>
      }
    />
  );
}

function chatStatusLabel(status: ProductChat["status"]): string {
  switch (status) {
    case "running":
      return "Running";
    case "idle":
      return "Idle";
    case "paused":
      return "Paused";
    case "failed":
      return "Failed";
    case "done":
      return "Done";
  }
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
