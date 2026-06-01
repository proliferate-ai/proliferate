import type { ComponentProps } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { MobileCloudChat } from "../../../navigation/navigation-model";
import { colors, spacing } from "../../../styles/tokens";
import { MobileWorkspaceCard } from "../../work/MobileWorkspaceCard";

type MobileWorkspaceCardItem = ComponentProps<typeof MobileWorkspaceCard>["item"];

export function MobileHomeRecentSection({
  items,
  onOpenChat,
}: {
  items: readonly MobileWorkspaceCardItem[];
  onOpenChat: (chat: MobileCloudChat) => void;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <View style={styles.recentSection}>
      <View style={styles.recentHeader}>
        <Text style={styles.recentTitle}>Recent</Text>
      </View>
      <View style={styles.recentCards}>
        {items.map((item) => (
          <MobileWorkspaceCard
            key={item.view.id}
            item={item}
            compact
            onPress={() => onOpenChat(item.chat)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  recentSection: {
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    marginTop: spacing[6],
  },
  recentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  recentTitle: {
    color: colors.faint,
    fontSize: 12.5,
    fontWeight: "600",
  },
  recentCards: {
    gap: spacing[2],
  },
});
