import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CloudChatTranscriptRowView } from "@proliferate/product-domain/chats/cloud/transcript-view";

import {
  isAssistantLoadingRow,
  isWorkHistoryRow,
  loadingStatusLabel,
  toolSummary,
  userMessageStatusLabel,
  workHistorySummary,
} from "../../../lib/domain/chat/mobile-chat-row-presentation";
import { MobileIcon } from "../../primitives/MobileIcon";
import { MobileMarkdownText } from "../MobileMarkdownText";
import { colors, spacing } from "../../../styles/tokens";

interface MobileChatMessageRowProps {
  row: CloudChatTranscriptRowView;
  onToolPress: (row: CloudChatTranscriptRowView) => void;
}

export function MobileChatMessageRow({ row, onToolPress }: MobileChatMessageRowProps) {
  if (isWorkHistoryRow(row)) {
    return <WorkHistoryRow row={row} onPress={() => onToolPress(row)} />;
  }
  if (row.kind === "tool" || row.kind === "tool_group") {
    return <ToolRow row={row} onPress={() => onToolPress(row)} />;
  }
  if (isAssistantLoadingRow(row)) {
    return <MobileAssistantLoadingRow row={row} />;
  }
  const isUser = row.kind === "user";
  const isSystem = row.kind === "system";
  if (isUser) {
    const visibleStatus = userMessageStatusLabel(row.status);
    return (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          {row.body ? <Text style={styles.userBubbleText}>{row.body}</Text> : null}
          {visibleStatus ? <Text style={styles.userBubbleStatus}>{visibleStatus}</Text> : null}
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.assistantRow, isSystem && styles.systemRow]}>
      {row.title ? <Text style={styles.assistantTitle}>{row.title}</Text> : null}
      {row.body ? <MobileMarkdownText content={row.body} /> : null}
      {row.detail ? <Text style={styles.assistantDetail}>{row.detail}</Text> : null}
    </View>
  );
}

function MobileAssistantLoadingRow({ row }: { row: CloudChatTranscriptRowView }) {
  return (
    <View
      accessibilityLabel="Assistant response loading"
      accessibilityRole="progressbar"
      style={styles.assistantLoadingRow}
    >
      <Text style={styles.assistantLoadingText} numberOfLines={1}>
        {loadingStatusLabel(row)}
      </Text>
    </View>
  );
}

function WorkHistoryRow({ row, onPress }: { row: CloudChatTranscriptRowView; onPress: () => void }) {
  const summary = workHistorySummary(row);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open work history: ${summary}`}
      onPress={onPress}
      style={({ pressed }) => [styles.historyRow, pressed && styles.historyRowPressed]}
    >
      <View style={styles.historyIcon}>
        <MobileIcon name="terminal" size={15} color={colors.faint} />
      </View>
      <View style={styles.historyTextCluster}>
        <Text style={styles.historySummary} numberOfLines={1}>
          {summary}
        </Text>
        <MobileIcon name="chevron-right" size={16} color={colors.faint} />
      </View>
    </Pressable>
  );
}

function ToolRow({ row, onPress }: { row: CloudChatTranscriptRowView; onPress: () => void }) {
  const title = row.title ?? row.body ?? "Tool call";
  const summary = toolSummary(row);
  const visibleSummary = summary === "Tap for details" ? null : summary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.title ? `Open ${row.title}` : "Open tool details"}
      onPress={onPress}
      style={({ pressed }) => [styles.toolCard, pressed && styles.toolCardPressed]}
    >
      <View style={styles.toolIcon}>
        <MobileIcon name="terminal" size={15} color={colors.faint} />
      </View>
      <View style={styles.toolText}>
        <Text style={styles.toolTitle} numberOfLines={1}>{title}</Text>
        {visibleSummary ? <Text style={styles.toolSubtitle} numberOfLines={1}>{visibleSummary}</Text> : null}
        <MobileIcon name="chevron-right" size={16} color={colors.faint} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  userRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingLeft: spacing[6],
  },
  userBubble: {
    maxWidth: "92%",
    borderRadius: 20,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    gap: 4,
  },
  userBubbleText: {
    color: colors.fg,
    fontSize: 15,
    lineHeight: 21,
  },
  userBubbleStatus: {
    color: colors.faint,
    fontSize: 11,
  },
  assistantRow: {
    paddingRight: spacing[4],
    gap: 4,
  },
  systemRow: {
    opacity: 0.7,
  },
  assistantTitle: {
    color: colors.fg,
    fontSize: 15,
    fontWeight: "600",
  },
  assistantDetail: {
    color: colors.faint,
    fontSize: 12.5,
    lineHeight: 18,
  },
  assistantLoadingRow: {
    paddingRight: spacing[4],
    gap: 4,
  },
  assistantLoadingText: {
    color: "#f59e0b",
    fontSize: 15,
    lineHeight: 22,
    fontStyle: "italic",
  },
  historyRow: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: spacing[1],
  },
  historyRowPressed: {
    opacity: 0.72,
  },
  historyIcon: {
    width: 19,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  historyTextCluster: {
    maxWidth: "88%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  historySummary: {
    flexShrink: 1,
    minWidth: 0,
    color: "rgba(255,255,255,0.78)",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "500",
  },
  toolCard: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: spacing[1],
  },
  toolCardPressed: {
    opacity: 0.72,
  },
  toolIcon: {
    width: 19,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  toolText: {
    maxWidth: "88%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  toolTitle: {
    flexShrink: 1,
    minWidth: 0,
    color: "rgba(255,255,255,0.78)",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "500",
  },
  toolSubtitle: {
    color: colors.faint,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "500",
  },
});
