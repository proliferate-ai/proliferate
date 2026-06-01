import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { CloudPendingInteraction } from "@proliferate/cloud-sdk";
import type { CloudChatTranscriptRowView } from "@proliferate/product-domain/chats/cloud/transcript-view";

import {
  type PermissionInteractionOption,
  permissionInteractionOptions,
} from "../../../lib/domain/chat/mobile-chat-permissions";
import {
  isWorkHistoryRow,
  messageLabel,
  workHistorySummary,
} from "../../../lib/domain/chat/mobile-chat-row-presentation";
import { MobileIcon } from "../../primitives/MobileIcon";
import { colors, radius, spacing } from "../../../styles/tokens";

interface MobileChatToolDetailSheetProps {
  row: CloudChatTranscriptRowView | null;
  pendingPermission: CloudPendingInteraction | null;
  resolvingPermissionKey: string | null;
  permissionResolveError: string | null;
  onResolvePermission: (
    interaction: CloudPendingInteraction,
    option: PermissionInteractionOption,
  ) => void;
  onClose: () => void;
}

export function MobileChatToolDetailSheet({
  row,
  pendingPermission,
  resolvingPermissionKey,
  permissionResolveError,
  onResolvePermission,
  onClose,
}: MobileChatToolDetailSheetProps) {
  const permissionOptions = pendingPermission
    ? permissionInteractionOptions(pendingPermission)
    : [];
  return (
    <Modal visible={Boolean(row)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.toolSheetLayer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close tool details"
          style={styles.toolSheetScrim}
          onPress={onClose}
        />
        <View style={styles.toolSheet}>
          <View style={styles.toolSheetHeader}>
            <Text style={styles.toolSheetTitle} numberOfLines={1}>
              {row && isWorkHistoryRow(row)
                ? workHistorySummary(row)
                : row?.title ?? "Tool call"}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={({ pressed }) => [styles.toolSheetClose, pressed && styles.sendPressed]}
            >
              <MobileIcon name="close" size={17} color={colors.fg} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.toolSheetScroll}
            contentContainerStyle={styles.toolSheetContent}
          >
            {row?.status ? <Text style={styles.toolSheetMeta}>{row.status}</Text> : null}
            {row?.body ? <Text style={styles.toolSheetBody}>{row.body}</Text> : null}
            {row?.detail && !isWorkHistoryRow(row) ? (
              <Text style={styles.toolSheetDetail}>{row.detail}</Text>
            ) : null}
            {pendingPermission ? (
              <View style={styles.permissionBox}>
                <Text style={styles.permissionTitle}>Command approval</Text>
                <Text style={styles.permissionBody}>
                  Choose how to handle this request so the session can continue.
                </Text>
                <View style={styles.permissionActions}>
                  {permissionOptions.map((option) => {
                    const key = `${pendingPermission.requestId}:${option.optionId}`;
                    const resolving = resolvingPermissionKey === key;
                    const reject = option.kind.startsWith("reject");
                    return (
                      <Pressable
                        key={option.optionId}
                        accessibilityRole="button"
                        accessibilityLabel={option.label}
                        accessibilityState={{ disabled: Boolean(resolvingPermissionKey) }}
                        disabled={Boolean(resolvingPermissionKey)}
                        onPress={() => onResolvePermission(pendingPermission, option)}
                        style={({ pressed }) => [
                          styles.permissionButton,
                          reject ? styles.permissionRejectButton : styles.permissionAllowButton,
                          pressed && styles.permissionButtonPressed,
                          Boolean(resolvingPermissionKey) && styles.permissionButtonDisabled,
                        ]}
                      >
                        <Text
                          style={[
                            styles.permissionButtonText,
                            reject && styles.permissionRejectButtonText,
                          ]}
                        >
                          {resolving ? "Sending" : option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {permissionResolveError ? (
                  <Text style={styles.permissionError}>{permissionResolveError}</Text>
                ) : null}
              </View>
            ) : null}
            {row?.children?.length ? (
              <View style={styles.toolChildren}>
                {row.children.map((child) => (
                  <View key={child.id} style={styles.toolChild}>
                    <Text style={styles.toolChildTitle}>{child.title ?? messageLabel(child)}</Text>
                    {child.body ? <Text style={styles.toolChildBody}>{child.body}</Text> : null}
                    {child.detail ? <Text style={styles.toolChildDetail}>{child.detail}</Text> : null}
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  toolSheetLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  toolSheetScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlayStrong,
  },
  toolSheet: {
    maxHeight: "78%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingTop: spacing[2],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[5],
  },
  toolSheetHeader: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  toolSheetTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.fg,
    fontSize: 16,
    fontWeight: "600",
  },
  toolSheetClose: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  toolSheetScroll: {
    minHeight: 0,
  },
  toolSheetContent: {
    gap: spacing[3],
    paddingBottom: spacing[4],
  },
  toolSheetMeta: {
    color: colors.faint,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  toolSheetBody: {
    color: colors.fg,
    fontSize: 14,
    lineHeight: 20,
  },
  toolSheetDetail: {
    color: colors.faint,
    fontSize: 12.5,
    lineHeight: 18,
  },
  permissionBox: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    backgroundColor: colors.background,
    padding: spacing[3],
    gap: spacing[2],
  },
  permissionTitle: {
    color: colors.fg,
    fontSize: 13.5,
    fontWeight: "700",
  },
  permissionBody: {
    color: colors.faint,
    fontSize: 12.5,
    lineHeight: 18,
  },
  permissionActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  permissionButton: {
    minHeight: 34,
    borderRadius: radius.full,
    paddingHorizontal: spacing[3],
    alignItems: "center",
    justifyContent: "center",
  },
  permissionAllowButton: {
    backgroundColor: colors.fg,
  },
  permissionRejectButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    backgroundColor: colors.card,
  },
  permissionButtonPressed: {
    opacity: 0.82,
  },
  permissionButtonDisabled: {
    opacity: 0.56,
  },
  permissionButtonText: {
    color: colors.background,
    fontSize: 12.5,
    fontWeight: "700",
  },
  permissionRejectButtonText: {
    color: colors.fg,
  },
  permissionError: {
    color: colors.red,
    fontSize: 12,
    lineHeight: 16,
  },
  toolChildren: {
    gap: spacing[2],
  },
  toolChild: {
    borderRadius: radius.md,
    backgroundColor: colors.background,
    padding: spacing[3],
    gap: spacing[1],
  },
  toolChildTitle: {
    color: colors.fg,
    fontSize: 13,
    fontWeight: "600",
  },
  toolChildBody: {
    color: colors.fg,
    fontSize: 12.5,
    lineHeight: 18,
  },
  toolChildDetail: {
    color: colors.faint,
    fontSize: 11.5,
    lineHeight: 16,
  },
  sendPressed: {
    opacity: 0.85,
  },
});
