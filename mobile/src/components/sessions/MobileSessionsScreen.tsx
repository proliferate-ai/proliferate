import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { deriveClaimState } from "@proliferate/product-model/chats/claiming";
import { chatKindPresentation, claimStateLabel } from "@proliferate/product-model/chats/presentation";
import type { ProductChat } from "@proliferate/product-model/chats/model";

import { MobileGlyph } from "../primitives/MobileGlyph";
import { chats, currentUser, workspaceForChat } from "../../lib/fixtures/mobile-fixtures";
import { colors, radius, text } from "../../styles/tokens";

interface MobileSessionsScreenProps {
  onOpenChat: (chat: ProductChat) => void;
}

export function MobileSessionsScreen({ onOpenChat }: MobileSessionsScreenProps) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.stack}>
        <View>
          <Text style={text.eyebrow}>Sessions</Text>
          <Text style={styles.title}>Running and recent work</Text>
        </View>

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
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {chat.title}
                  </Text>
                  <Text style={styles.status}>{chat.status}</Text>
                </View>
                <Text style={text.caption} numberOfLines={1}>
                  {presentation.label} - {workspace?.name ?? "Unknown"}
                </Text>
                <Text style={styles.claim}>{claimLabel}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 18,
    paddingBottom: 96,
  },
  stack: {
    gap: 12,
  },
  title: {
    ...text.title,
    marginTop: 8,
  },
  card: {
    flexDirection: "row",
    gap: 12,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
  },
  pressed: {
    opacity: 0.72,
  },
  cardBody: {
    minWidth: 0,
    flex: 1,
    gap: 4,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardTitle: {
    minWidth: 0,
    flex: 1,
    color: colors.fg,
    fontSize: 15,
    fontWeight: "700",
  },
  status: {
    overflow: "hidden",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    color: colors.green,
    backgroundColor: "rgba(64,201,119,0.10)",
    fontSize: 11,
    fontWeight: "700",
  },
  claim: {
    color: colors.faint,
    fontSize: 12,
  },
});
