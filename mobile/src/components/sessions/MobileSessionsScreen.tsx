import { Pressable, StyleSheet, Text, View } from "react-native";

import { deriveClaimState } from "@proliferate/product-model/chats/claiming";
import { chatKindPresentation, claimStateLabel } from "@proliferate/product-model/chats/presentation";
import type { ProductChat } from "@proliferate/product-model/chats/model";

import { MobileGlyph } from "../primitives/MobileGlyph";
import {
  MobileCardTitle,
  MobileScreen,
  MobileScreenHeader,
  MobileStack,
  MobileStatusPill,
} from "../primitives/MobileLayout";
import { chats, currentUser, workspaceForChat } from "../../lib/fixtures/mobile-fixtures";
import { colors, radius, spacing, text } from "../../styles/tokens";

interface MobileSessionsScreenProps {
  onOpenChat: (chat: ProductChat) => void;
}

export function MobileSessionsScreen({ onOpenChat }: MobileSessionsScreenProps) {
  return (
    <MobileScreen>
      <MobileStack>
        <MobileScreenHeader eyebrow="Sessions" title="Running and recent work" />

        {chats.map((chat) => {
          const presentation = chatKindPresentation(chat.kind);
          const claimLabel = claimStateLabel(deriveClaimState(chat, currentUser));
          const workspace = workspaceForChat(chat);

          return (
            <Pressable
              key={chat.id}
              accessibilityRole="button"
              onPress={() => onOpenChat(chat)}
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            >
              <MobileGlyph tone={chat.status === "running" ? "success" : "muted"}>
                {presentation.label.slice(0, 1)}
              </MobileGlyph>
              <View style={styles.cardBody}>
                <View style={styles.rowBetween}>
                  <MobileCardTitle numberOfLines={1} style={styles.cardTitle}>
                    {chat.title}
                  </MobileCardTitle>
                  <MobileStatusPill tone={chat.status === "running" ? "success" : "muted"}>
                    {chat.status}
                  </MobileStatusPill>
                </View>
                <Text style={text.caption} numberOfLines={1}>
                  {presentation.label} - {workspace?.name ?? "Unknown"}
                </Text>
                <Text style={styles.claim}>{claimLabel}</Text>
              </View>
            </Pressable>
          );
        })}
      </MobileStack>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: spacing[3],
  },
  pressed: {
    opacity: 0.72,
  },
  cardBody: {
    minWidth: 0,
    flex: 1,
    gap: spacing[1],
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardTitle: {
    minWidth: 0,
    flex: 1,
  },
  claim: {
    color: colors.faint,
    fontSize: 12,
  },
});
