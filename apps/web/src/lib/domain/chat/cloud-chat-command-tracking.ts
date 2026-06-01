import type { CloudPendingInteraction } from "@proliferate/cloud-sdk";
import type { PendingConfigChange } from "@proliferate/product-domain/chats/cloud/composer-controls";

import type { CloudChatOptimisticPrompt } from "./cloud-chat-prompt-projection";

export function commandIdsKey(commandIds: readonly string[]): string {
  return commandIds.join("\0");
}

export function latestPendingPromptCommandId(
  pendingInteractions: readonly CloudPendingInteraction[],
): string | null {
  return pendingPromptCommandIdsFromInteractions(pendingInteractions)[0] ?? null;
}

export function pendingPromptCommandIdsFromInteractions(
  pendingInteractions: readonly CloudPendingInteraction[],
): string[] {
  return pendingInteractions
    .filter((interaction) =>
      interaction.kind === "send_prompt"
      && interaction.status === "pending"
    )
    .map((interaction) => ({
      commandId: pendingInteractionCommandId(interaction),
      requestedSeq: interaction.requestedSeq,
    }))
    .filter((candidate): candidate is { commandId: string; requestedSeq: number } =>
      candidate.commandId !== null
    )
    .sort((left, right) => right.requestedSeq - left.requestedSeq)
    .map((candidate) => candidate.commandId);
}

export function optimisticPromptCommandIdsFromPrompts(
  prompts: readonly CloudChatOptimisticPrompt[],
): string[] {
  return [...new Set(
    prompts
      .filter((prompt) => prompt.status !== "failed")
      .map((prompt) => prompt.commandId?.trim() ?? "")
      .filter((commandId) => commandId.length > 0),
  )];
}

export function pendingConfigCommandIdsFromChanges(
  pendingConfigChanges: Record<string, PendingConfigChange>,
): string[] {
  return [...new Set(
    Object.values(pendingConfigChanges)
      .map((change) => change.commandId?.trim() ?? "")
      .filter((commandId) => commandId.length > 0),
  )];
}

export function removePendingConfigCommand(
  pendingConfigChanges: Record<string, PendingConfigChange>,
  commandId: string,
): Record<string, PendingConfigChange> {
  const next = Object.fromEntries(
    Object.entries(pendingConfigChanges).filter(([_key, change]) =>
      change.commandId !== commandId
    ),
  );
  return Object.keys(next).length === Object.keys(pendingConfigChanges).length
    ? pendingConfigChanges
    : next;
}

export function pendingInteractionCommandId(interaction: CloudPendingInteraction): string | null {
  const payload = interaction.payload;
  if (!payload) {
    return null;
  }
  const commandId = payload.commandId;
  return typeof commandId === "string" && commandId.trim() ? commandId.trim() : null;
}
