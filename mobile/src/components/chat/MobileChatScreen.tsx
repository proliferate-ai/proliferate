import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  useCloudTranscriptSnapshot,
  useCommandStatus,
  useClaimCloudWorkspace,
  useEnqueueCloudCommand,
  useSessionLive,
} from "@proliferate/cloud-sdk-react";
import type { CloudTranscriptItem } from "@proliferate/cloud-sdk";

import { MobileIcon } from "../primitives/MobileIcon";
import { MobileStatusDot } from "../primitives/MobileStatusDot";
import { MobileTextInput } from "../primitives/MobileTextInput";
import { MobileTopBar, MobileTopBarIconButton } from "../primitives/MobileTopBar";
import type { MobileCloudChat } from "../../navigation/navigation-model";
import { colors, radius, spacing } from "../../styles/tokens";

interface MobileChatScreenProps {
  chat: MobileCloudChat;
  onBack: () => void;
}

type SendPromptPayload = {
  text: string;
};

export function MobileChatScreen({ chat, onBack }: MobileChatScreenProps) {
  const [draft, setDraft] = useState("");
  const [latestCommandId, setLatestCommandId] = useState<string | null>(null);
  const [claimedLocally, setClaimedLocally] = useState(false);
  const sessionLive = useSessionLive(chat.sessionId, {
    targetId: chat.targetId,
  });
  const transcript = useCloudTranscriptSnapshot(chat.targetId, chat.sessionId);
  const enqueuePrompt = useEnqueueCloudCommand<SendPromptPayload>();
  const claimWorkspace = useClaimCloudWorkspace();
  const commandStatus = useCommandStatus(latestCommandId);
  const messages = sessionLive.snapshot?.transcriptItems ?? transcript.data?.transcriptItems ?? [];
  const isUnclaimed = chat.visibility === "shared_unclaimed" && !claimedLocally;
  const canSubmit = Boolean(draft.trim() && !enqueuePrompt.isPending && !isUnclaimed);

  async function submitPrompt() {
    const text = draft.trim();
    if (!text) {
      return;
    }
    const command = await enqueuePrompt.mutateAsync({
      idempotencyKey: `mobile:${chat.workspaceId}:${chat.sessionId}:${Date.now()}`,
      targetId: chat.targetId,
      workspaceId: chat.workspaceRuntimeId,
      cloudWorkspaceId: chat.workspaceId,
      sessionId: chat.sessionId,
      kind: "send_prompt",
      source: "mobile",
      payload: { text },
    });
    setLatestCommandId(command.commandId);
    setDraft("");
  }

  async function claimChat() {
    await claimWorkspace.mutateAsync({ workspaceId: chat.workspaceId });
    setClaimedLocally(true);
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.select({ ios: "padding", default: undefined })}
      keyboardVerticalOffset={80}
    >
      <View style={styles.headerWrapper}>
        <MobileTopBar
          title={chat.title}
          subtitle={`${chat.workspaceName} · ${chat.repoLabel}`}
          leading={{ kind: "back", onPress: onBack }}
          trailing={
            <View style={styles.headerStatus}>
              <MobileStatusDot status={mobileStatus(chat.status)} />
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
        {isUnclaimed ? (
          <View style={styles.claimBanner}>
            <View style={styles.claimIcon}>
              <MobileIcon name="hand" size={16} color={colors.success} />
            </View>
            <View style={styles.claimText}>
              <Text style={styles.claimTitle}>Unclaimed shared chat</Text>
              <Text style={styles.claimBody}>
                Claim this work before sending prompts from mobile.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Claim shared chat"
              accessibilityState={{ disabled: claimWorkspace.isPending }}
              disabled={claimWorkspace.isPending}
              onPress={() => void claimChat()}
              style={({ pressed }) => [
                styles.claimButton,
                claimWorkspace.isPending && styles.claimButtonDisabled,
                pressed && styles.claimButtonPressed,
              ]}
            >
              <Text style={styles.claimButtonText}>
                {claimWorkspace.isPending ? "Claiming" : "Claim"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.controlNote}>
          <Text style={styles.controlNoteText}>
            {sessionLive.isConnected ? "Live cloud projection" : "Snapshot projection"}
          </Text>
        </View>

        <View style={styles.messages}>
          {messages.length > 0 ? (
            messages.map((message) => <Message key={message.itemId} item={message} />)
          ) : (
            <View style={styles.message}>
              <Text style={styles.messageRole}>system</Text>
              <Text style={styles.messageBody}>Waiting for projected transcript events.</Text>
            </View>
          )}
        </View>

        {commandStatus.data?.status ? (
          <View style={styles.controlNote}>
            <Text style={styles.controlNoteText}>
              {commandStatus.data.errorMessage ?? `Command ${commandStatus.data.status}`}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.composer}>
        <MobileTextInput
          multiline
          value={draft}
          onChangeText={setDraft}
          placeholder={isUnclaimed ? "Claim this chat to reply" : "Message this session"}
          style={styles.composerInput}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !canSubmit }}
          disabled={!canSubmit}
          onPress={() => void submitPrompt()}
          style={({ pressed }) => [
            styles.send,
            !canSubmit && styles.sendDisabled,
            pressed && styles.sendPressed,
          ]}
        >
          <MobileIcon name="send" size={16} color={canSubmit ? colors.background : colors.faint} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Message({ item }: { item: CloudTranscriptItem }) {
  const role = transcriptRole(item);
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
      <Text style={styles.messageBody}>
        {item.text ?? item.title ?? item.kind ?? "Projected event"}
      </Text>
    </View>
  );
}

function transcriptRole(item: CloudTranscriptItem): "user" | "assistant" | "system" {
  if (item.kind === "user_message" || item.kind === "prompt") {
    return "user";
  }
  if (item.kind === "system" || item.kind === "tool") {
    return "system";
  }
  return "assistant";
}

function mobileStatus(status: string): "running" | "idle" | "paused" | "failed" | "done" {
  if (status === "running") {
    return "running";
  }
  if (status === "failed" || status === "error") {
    return "failed";
  }
  if (status === "paused") {
    return "paused";
  }
  if (status === "ended" || status === "done" || status === "completed") {
    return "done";
  }
  return "idle";
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
  claimButton: {
    borderRadius: radius.md,
    backgroundColor: colors.success,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  claimButtonPressed: {
    opacity: 0.82,
  },
  claimButtonDisabled: {
    opacity: 0.56,
  },
  claimButtonText: {
    color: colors.background,
    fontSize: 12,
    fontWeight: "700",
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
    letterSpacing: 0,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  messageBody: {
    color: colors.fg,
    fontSize: 14.5,
    lineHeight: 21,
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
  sendDisabled: {
    backgroundColor: colors.accent,
  },
  sendPressed: {
    opacity: 0.85,
  },
});
