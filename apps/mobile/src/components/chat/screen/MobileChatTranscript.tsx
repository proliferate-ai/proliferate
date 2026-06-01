import { FlatList, StyleSheet, Text, View } from "react-native";
import type { CloudChatTranscriptRowView } from "@proliferate/product-domain/chats/cloud/transcript-view";

import { MobileChatMessageRow } from "./MobileChatMessageRow";
import { colors, radius, spacing } from "../../../styles/tokens";

interface MobileChatTranscriptProps {
  rows: readonly CloudChatTranscriptRowView[];
  emptyTitle: string;
  emptyBody: string;
  footerMessage: string | null;
  onToolPress: (row: CloudChatTranscriptRowView) => void;
}

export function MobileChatTranscript({
  rows,
  emptyTitle,
  emptyBody,
  footerMessage,
  onToolPress,
}: MobileChatTranscriptProps) {
  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      data={rows}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <MobileChatMessageRow row={item} onToolPress={onToolPress} />
      )}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{emptyTitle}</Text>
          <Text style={styles.emptyBody}>{emptyBody}</Text>
        </View>
      }
      ListFooterComponent={
        footerMessage ? (
          <View style={styles.controlNote}>
            <Text style={styles.controlNoteText}>{footerMessage}</Text>
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  content: {
    padding: spacing[4],
    paddingBottom: spacing[5],
    gap: spacing[3],
  },
  controlNote: {
    marginTop: spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  controlNoteText: {
    color: colors.faint,
    fontSize: 12,
    fontStyle: "italic",
  },
  empty: {
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    borderStyle: "dashed",
  },
  emptyTitle: {
    color: colors.fg,
    fontSize: 15,
    fontWeight: "600",
  },
  emptyBody: {
    marginTop: 4,
    color: colors.faint,
    fontSize: 13,
    lineHeight: 18,
  },
});
