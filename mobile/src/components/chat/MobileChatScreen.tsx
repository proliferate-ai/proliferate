import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { deriveClaimState, getPrimaryChatAction } from "@proliferate/product-model/chats/claiming";
import { chatKindPresentation } from "@proliferate/product-model/chats/presentation";
import type { ProductChat } from "@proliferate/product-model/chats/model";

import { MobileIcon } from "../primitives/MobileIcon";
import { MobileStatusDot } from "../primitives/MobileStatusDot";
import { MobileTextInput } from "../primitives/MobileTextInput";
import { MobileTopBar, MobileTopBarIconButton } from "../primitives/MobileTopBar";
import { chatMessages, currentUser, workspaceForChat } from "../../lib/fixtures/mobile-fixtures";
import { colors, radius, spacing } from "../../styles/tokens";

interface MobileChatScreenProps {
  chat: ProductChat;
  onBack: () => void;
}

export function MobileChatScreen({ chat, onBack }: MobileChatScreenProps) {
  const workspace = workspaceForChat(chat);
  const presentation = chatKindPresentation(chat.kind);
  const claimState = deriveClaimState(chat, currentUser);
  const action = getPrimaryChatAction(chat, currentUser);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.select({ ios: "padding", default: undefined })}
      keyboardVerticalOffset={80}
    >
      <View style={styles.headerWrapper}>
        <MobileTopBar
          title={chat.title}
          subtitle={`${workspace?.name ?? "Unknown"} · ${presentation.label}`}
          leading={{ kind: "back", onPress: onBack }}
          trailing={
            <View style={styles.headerStatus}>
              <MobileStatusDot status={chat.status} />
              <MobileTopBarIconButton name="more" accessibilityLabel="Chat menu" />
            </View>
          }
        />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {claimState.kind === "unclaimed" ? (
          <View style={styles.claimBanner}>
            <View style={styles.claimIcon}>
              <MobileIcon name="hand" size={16} color={colors.success} />
            </View>
            <View style={styles.claimText}>
              <Text style={styles.claimTitle}>Unclaimed shared chat</Text>
              <Text style={styles.claimBody}>
                Claim this to take control. Anyone on the team can pick it up
                until then.
              </Text>
            </View>
          </View>
        ) : null}

        {claimState.kind === "claimed_by_me" ? (
          <View style={styles.controlNote}>
            <Text style={styles.controlNoteText}>You control this chat.</Text>
          </View>
        ) : null}

        <View style={styles.messages}>
          {chatMessages.map((message) => (
            <Message key={message.id} role={message.role} body={message.body} />
          ))}
        </View>

        <View style={styles.actionChips}>
          <ActionChip icon="git-branch" label="Diff" />
          <ActionChip icon="external" label="Create PR" />
        </View>
      </ScrollView>

      <View style={styles.composer}>
        <MobileTextInput
          multiline
          placeholder={
            action.kind === "claim"
              ? "Claim and reply..."
              : "Message this session"
          }
          style={styles.composerInput}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.kind === "claim" ? "Claim" : "Send"}
          style={({ pressed }) => [styles.send, pressed && styles.sendPressed]}
        >
          <MobileIcon
            name={action.kind === "claim" ? "hand" : "send"}
            size={16}
            color={colors.background}
          />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Message({ role, body }: { role: string; body: string }) {
  const isAssistant = role === "assistant";
  const isSystem = role === "system";
  return (
    <View
      style={[
        styles.message,
        isAssistant && styles.messageAssistant,
        isSystem && styles.messageSystem,
      ]}
    >
      <Text style={styles.messageRole}>{role}</Text>
      <Text style={styles.messageBody}>{body}</Text>
    </View>
  );
}

function ActionChip({ icon, label }: { icon: "git-branch" | "external"; label: string }) {
  return (
    <Pressable style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}>
      <MobileIcon name={icon} size={13} color={colors.mutedForeground} />
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerWrapper: {
    backgroundColor: colors.background,
  },
  headerStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingRight: spacing[1],
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing[4],
    paddingBottom: spacing[6],
    gap: spacing[3],
  },
  claimBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.successSubtle,
    backgroundColor: colors.successSubtle,
  },
  claimIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  claimText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  claimTitle: {
    color: colors.fg,
    fontSize: 14,
    fontWeight: "600",
  },
  claimBody: {
    color: colors.mutedForeground,
    fontSize: 12.5,
    lineHeight: 17,
  },
  controlNote: {
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
  messages: {
    gap: spacing[2],
    marginTop: spacing[1],
  },
  message: {
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
  },
  messageAssistant: {
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  messageSystem: {
    backgroundColor: "transparent",
    borderColor: colors.borderLight,
    borderStyle: "dashed",
  },
  messageRole: {
    color: colors.faint,
    fontSize: 10.5,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  messageBody: {
    color: colors.fg,
    fontSize: 14.5,
    lineHeight: 21,
  },
  actionChips: {
    flexDirection: "row",
    gap: spacing[2],
    marginTop: spacing[1],
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing[3],
    paddingVertical: 7,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipPressed: {
    opacity: 0.78,
  },
  chipText: {
    color: colors.mutedForeground,
    fontSize: 12.5,
    fontWeight: "500",
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    paddingBottom: spacing[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight,
    backgroundColor: colors.background,
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: 22,
  },
  send: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.fg,
  },
  sendPressed: {
    opacity: 0.85,
  },
});
