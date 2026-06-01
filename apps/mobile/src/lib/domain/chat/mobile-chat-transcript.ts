import type {
  CloudPendingInteraction,
  CloudTranscriptItem,
} from "@proliferate/cloud-sdk";
import {
  cloudTranscriptHasAgentProgressAfterPrompt,
  cloudTranscriptHasUserPrompt,
  type CloudChatTranscriptRowView,
} from "@proliferate/product-domain/chats/cloud/transcript-view";

export type OptimisticPromptStatus = "sending" | "queued" | "failed";

export type OptimisticPrompt = {
  id: string;
  sessionId: string;
  text: string;
  baseTranscriptSeq: number;
  status: OptimisticPromptStatus;
  commandId?: string;
};

type PendingPromptRowInput = {
  id: string;
  text: string;
  dispatchedSessionId?: string | null;
  failedAt?: number | null;
  failureMessage?: string | null;
};

export function buildPendingPromptRows(
  pendingPrompt: PendingPromptRowInput | null,
  sessionId: string | null,
  pendingInteractions: readonly CloudPendingInteraction[],
  failed: boolean,
  failureMessage: string | null,
  promptVisible: boolean,
  agentStarted: boolean,
): CloudChatTranscriptRowView[] {
  if (!pendingPrompt) {
    return [];
  }
  if (pendingInteractionMatchesPendingPrompt(pendingPrompt, pendingInteractions)) {
    return [];
  }
  if (pendingPrompt.dispatchedSessionId) {
    if (sessionId !== pendingPrompt.dispatchedSessionId || agentStarted) {
      return [];
    }
  } else if (sessionId) {
    return [];
  }
  const promptFailed = failed || Boolean(pendingPrompt.failedAt);
  const rows: CloudChatTranscriptRowView[] = [];
  if (!promptVisible) {
    rows.push({
      id: `${pendingPrompt.id}:pending-user`,
      kind: "user",
      body: pendingPrompt.text,
      status: promptFailed ? "Failed" : "Queued",
      streaming: !promptFailed,
    });
  }
  if (promptFailed || !agentStarted) {
    rows.push({
      id: `${pendingPrompt.id}:pending-assistant`,
      kind: "assistant",
      body: promptFailed
        ? pendingPrompt.failureMessage
          ?? failureMessage
          ?? "Queued prompt could not be sent."
        : null,
      detail: promptFailed
        ? null
        : failureMessage ?? (
          pendingPrompt.dispatchedSessionId
            ? "Waiting for response."
            : "Preparing workspace and session."
        ),
      streaming: !promptFailed,
    });
  }
  return rows;
}

export function buildOptimisticPromptRows(input: {
  prompts: readonly OptimisticPrompt[];
  sessionId: string | null;
  transcriptItems: readonly CloudTranscriptItem[];
  transcriptRows: readonly CloudChatTranscriptRowView[];
  pendingInteractions: readonly CloudPendingInteraction[];
  status: string | null;
  allowTextOnlyRowFallback: boolean;
}): CloudChatTranscriptRowView[] {
  if (!input.sessionId) {
    return [];
  }
  const rows: CloudChatTranscriptRowView[] = [];
  for (const prompt of input.prompts) {
    if (prompt.sessionId !== input.sessionId) {
      continue;
    }
    if (pendingInteractionMatchesOptimisticPrompt(prompt, input.pendingInteractions)) {
      continue;
    }
    const promptVisible = cloudTranscriptHasUserPrompt({
      prompt,
      transcriptItems: input.transcriptItems,
      transcriptRows: input.transcriptRows,
      allowTextOnlyRowFallback: input.allowTextOnlyRowFallback,
    });
    const agentStarted = cloudTranscriptHasAgentProgressAfterPrompt({
      prompt,
      transcriptItems: input.transcriptItems,
      transcriptRows: input.transcriptRows,
      allowTextOnlyRowFallback: input.allowTextOnlyRowFallback,
    });
    const hasTranscriptProgressAfterPrompt = transcriptHasAgentProgressAfterBaseline(
      input.transcriptRows,
      prompt.baseTranscriptSeq,
    );
    if (!promptVisible) {
      rows.push({
        id: `${prompt.id}:user`,
        kind: "user",
        body: prompt.text,
        status: optimisticPromptStatusLabel(prompt.status),
        streaming: prompt.status !== "failed",
      });
    }
    if (prompt.status !== "failed" && !agentStarted && !hasTranscriptProgressAfterPrompt) {
      rows.push({
        id: `${prompt.id}:assistant-waiting`,
        kind: "assistant",
        body: null,
        detail: input.status ?? (prompt.status === "sending" ? "Sending message." : "Waiting for response."),
        streaming: true,
      });
    }
  }
  return rows;
}

export function transcriptHasAgentProgressAfterBaseline(
  rows: readonly CloudChatTranscriptRowView[],
  baseTranscriptSeq: number,
): boolean {
  return rows.some((row) =>
    row.kind !== "user"
    && row.kind !== "system"
    && typeof row.firstSeq === "number"
    && row.firstSeq > baseTranscriptSeq
  );
}

export function latestPendingPromptCommandId(
  pendingInteractions: readonly CloudPendingInteraction[],
): string | null {
  return [...pendingInteractions]
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
    .sort((left, right) => right.requestedSeq - left.requestedSeq)[0]?.commandId ?? null;
}

export function pendingInteractionMatchesOptimisticPrompt(
  prompt: OptimisticPrompt,
  pendingInteractions: readonly CloudPendingInteraction[],
): boolean {
  return pendingInteractions.some((interaction) =>
    interaction.kind === "send_prompt"
    && (interaction.status === "pending" || interaction.status === "failed")
    && (
      interaction.requestId === prompt.id
      || (
        prompt.commandId !== null
        && prompt.commandId !== undefined
        && pendingInteractionCommandId(interaction) === prompt.commandId
      )
    )
  );
}

export function pendingInteractionMatchesPendingPrompt(
  prompt: PendingPromptRowInput,
  pendingInteractions: readonly CloudPendingInteraction[],
): boolean {
  return pendingInteractions.some((interaction) =>
    interaction.kind === "send_prompt"
    && (interaction.status === "pending" || interaction.status === "failed")
    && pendingInteractionMatchesPendingPromptIdentity(prompt, interaction)
  );
}

export function failedPendingInteractionForPendingPrompt(
  prompt: PendingPromptRowInput,
  pendingInteractions: readonly CloudPendingInteraction[],
): CloudPendingInteraction | null {
  return pendingInteractions.find((interaction) =>
    interaction.kind === "send_prompt"
    && interaction.status === "failed"
    && pendingInteractionMatchesPendingPromptIdentity(prompt, interaction)
  ) ?? null;
}

export function failedPendingInteractionMessage(interaction: CloudPendingInteraction): string {
  const payloadMessage = interaction.payload?.errorMessage;
  return interaction.description
    || (typeof payloadMessage === "string" && payloadMessage.trim()
      ? payloadMessage.trim()
      : null)
    || "Queued prompt could not be sent.";
}

export function pendingInteractionCommandId(interaction: CloudPendingInteraction): string | null {
  const payload = interaction.payload;
  if (!payload) {
    return null;
  }
  const commandId = payload.commandId;
  return typeof commandId === "string" && commandId.trim() ? commandId.trim() : null;
}

export function optimisticPromptFromPending(
  prompt: PendingPromptRowInput,
  sessionId: string,
): OptimisticPrompt {
  return {
    id: `${prompt.id}:pending`,
    sessionId,
    text: prompt.text,
    baseTranscriptSeq: 0,
    status: "queued",
  };
}

export function markPendingPromptFailed<TPrompt extends PendingPromptRowInput>(
  prompt: TPrompt,
  message: string,
  failedAt: number,
): TPrompt & { failedAt: number; failureMessage: string } {
  return {
    ...prompt,
    failedAt,
    failureMessage: message,
  };
}

export function optimisticPromptStatusLabel(status: OptimisticPromptStatus): string {
  switch (status) {
    case "failed":
      return "Failed";
    case "queued":
      return "Queued";
    case "sending":
    default:
      return "Sending";
  }
}

function pendingInteractionMatchesPendingPromptIdentity(
  prompt: PendingPromptRowInput,
  interaction: CloudPendingInteraction,
): boolean {
  return interaction.requestId === prompt.id
    || interaction.requestId === `${prompt.id}:send`
    || pendingInteractionPromptId(interaction) === prompt.id;
}

function pendingInteractionPromptId(interaction: CloudPendingInteraction): string | null {
  const payload = interaction.payload;
  if (!payload) {
    return null;
  }
  const promptId = payload.promptId;
  return typeof promptId === "string" && promptId.trim() ? promptId.trim() : null;
}
