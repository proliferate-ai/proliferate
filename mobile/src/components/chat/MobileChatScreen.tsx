import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import { deriveClaimState, getPrimaryChatAction } from "@proliferate/product-model/chats/claiming";
import { chatKindPresentation, claimStateLabel } from "@proliferate/product-model/chats/presentation";
import type { ProductChat } from "@proliferate/product-model/chats/model";

import { MobileButton } from "../primitives/MobileButton";
import { MobileCard } from "../primitives/MobileLayout";
import { MobileTextInput } from "../primitives/MobileTextInput";
import { chatMessages, currentUser, workspaceForChat } from "../../lib/fixtures/mobile-fixtures";
import { colors, radius, spacing, text } from "../../styles/tokens";

interface MobileChatScreenProps {
  chat: ProductChat;
}

export function MobileChatScreen({ chat }: MobileChatScreenProps) {
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
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerBlock}>
          <Text style={text.eyebrow}>{presentation.label}</Text>
          <Text style={styles.title}>{chat.title}</Text>
          <Text style={text.caption}>
            {workspace?.repoLabel ?? "Unknown repo"} - {claimStateLabel(claimState)}
          </Text>
        </View>

        {claimState.kind === "unclaimed" && (
          <MobileCard style={styles.claimBanner}>
            <Text style={styles.bannerTitle}>Unclaimed shared session</Text>
            <Text style={text.caption}>Claim this session before continuing from Desktop.</Text>
          </MobileCard>
        )}

        <View style={styles.messageStack}>
          {chatMessages.map((message) => (
            <View
              key={message.id}
              style={[styles.message, message.role === "assistant" ? styles.assistant : styles.user]}
            >
              <Text style={styles.messageRole}>{message.role}</Text>
              <Text style={styles.messageBody}>{message.body}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.composer}>
        <MobileTextInput multiline placeholder="Message this session" style={styles.composerInput} />
        <MobileButton label={action.kind === "claim" ? "Claim" : "Send"} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    padding: spacing[5],
    paddingBottom: spacing[6],
  },
  headerBlock: {
    gap: spacing[2],
    marginBottom: spacing[4],
  },
  title: {
    ...text.title,
  },
  claimBanner: {
    gap: spacing[2],
    borderColor: colors.blue,
    backgroundColor: colors.infoSubtle,
    marginBottom: spacing[4],
  },
  bannerTitle: {
    color: colors.fg,
    fontSize: 14,
    fontWeight: "700",
  },
  messageStack: {
    gap: spacing[3],
  },
  message: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing[3],
  },
  assistant: {
    backgroundColor: colors.card,
  },
  user: {
    backgroundColor: colors.bg,
  },
  messageRole: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  messageBody: {
    color: colors.fg,
    fontSize: 14,
    lineHeight: 20,
  },
  composer: {
    gap: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    paddingBottom: spacing[5],
    backgroundColor: colors.bg,
  },
  composerInput: {
    minHeight: 72,
  },
});
