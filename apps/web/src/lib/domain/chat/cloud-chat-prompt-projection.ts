import type {
  CloudPendingInteraction,
  CloudTranscriptItem,
} from "@proliferate/cloud-sdk";
import {
  cloudTranscriptHasAgentProgressAfterPrompt,
  cloudTranscriptHasUserPrompt,
  type CloudChatTranscriptRowView,
} from "@proliferate/product-domain/chats/cloud/transcript-view";
import { createPromptOutboxEntry, type PromptOutboxEntry } from "@proliferate/product-domain/sessions/intents/session-intent-model";

import {
  friendlyCommandStatusMessage,
  isWorkspacePreparationStatus,
} from "./cloud-chat-command-presentation";
import { pendingInteractionCommandId } from "./cloud-chat-command-tracking";

export interface CloudChatOptimisticPrompt {
  id: string;
  workspaceId: string;
  sessionId: string | null;
  text: string;
  baseTranscriptSeq: number;
  status: "sending" | "queued" | "failed";
  commandId?: string | null;
  errorMessage?: string | null;
  createdAt: number;
}

export interface CloudChatPendingHomePromptProjection {
  id: string;
  text: string;
  status?: "pending" | "failed";
  errorMessage?: string | null;
  createdAt: number;
}

export function buildCloudPromptOutboxEntries(input: {
  prompts: readonly CloudChatOptimisticPrompt[];
  pendingHomePrompt: CloudChatPendingHomePromptProjection | null;
  workspaceId: string | null;
  sessionId: string | null;
  pendingInteractions: readonly CloudPendingInteraction[];
  status: string | null;
}): PromptOutboxEntry[] {
  if (!input.workspaceId) {
    return [];
  }
  const entries: PromptOutboxEntry[] = [];
  for (const prompt of input.prompts) {
    if (prompt.workspaceId !== input.workspaceId) {
      continue;
    }
    if (input.sessionId) {
      if (prompt.sessionId !== input.sessionId) {
        continue;
      }
    } else if (prompt.sessionId !== null) {
      continue;
    }
    if (pendingInteractionMatchesOptimisticPrompt(prompt, input.pendingInteractions)) {
      continue;
    }
    entries.push(optimisticPromptToOutboxEntry(prompt, input.workspaceId, input.sessionId, input.status));
  }

  for (const interaction of input.pendingInteractions) {
    if (
      interaction.kind !== "send_prompt"
      || (interaction.status !== "pending" && interaction.status !== "failed")
    ) {
      continue;
    }
    const text = pendingInteractionPromptText(interaction);
    if (!text) {
      continue;
    }
    if (entries.some((entry) =>
      entry.clientPromptId === interaction.requestId
      || textMatches(entry.text, text)
    )) {
      continue;
    }
    entries.push(pendingInteractionToOutboxEntry(
      interaction,
      text,
      input.workspaceId,
      input.sessionId ?? `pending:${interaction.requestId}`,
    ));
  }

  if (input.pendingHomePrompt && !input.sessionId) {
    const duplicate = entries.some((entry) => textMatches(entry.text, input.pendingHomePrompt!.text));
    if (!duplicate) {
      entries.push(pendingHomePromptToOutboxEntry(
        input.pendingHomePrompt,
        input.workspaceId,
        input.status,
      ));
    }
  }
  return entries;
}

export function buildOptimisticPromptRows(input: {
  prompts: readonly CloudChatOptimisticPrompt[];
  workspaceId: string | null;
  sessionId: string | null;
  status: string | null;
  transcriptItems: readonly CloudTranscriptItem[];
  transcriptRows: readonly CloudChatTranscriptRowView[];
  pendingInteractions: readonly CloudPendingInteraction[];
  allowTextOnlyRowFallback: boolean;
}): CloudChatTranscriptRowView[] {
  if (!input.workspaceId) {
    return [];
  }
  const rows: CloudChatTranscriptRowView[] = [];
  for (const prompt of input.prompts) {
    if (prompt.workspaceId !== input.workspaceId) {
      continue;
    }
    if (input.sessionId) {
      if (prompt.sessionId !== input.sessionId) {
        continue;
      }
    } else if (prompt.sessionId !== null) {
      continue;
    }
    if (pendingInteractionMatchesOptimisticPrompt(prompt, input.pendingInteractions)) {
      continue;
    }
    const promptVisible = input.sessionId
      ? cloudTranscriptHasUserPrompt({
        prompt,
        transcriptItems: input.transcriptItems,
        transcriptRows: input.transcriptRows,
        allowTextOnlyRowFallback: input.allowTextOnlyRowFallback,
      })
      : false;
    const agentStarted = input.sessionId
      ? cloudTranscriptHasAgentProgressAfterPrompt({
        prompt,
        transcriptItems: input.transcriptItems,
        transcriptRows: input.transcriptRows,
        allowTextOnlyRowFallback: input.allowTextOnlyRowFallback,
      })
      : false;
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
      });
    }
    if (prompt.status === "sending" && !agentStarted && !hasTranscriptProgressAfterPrompt) {
      rows.push({
        id: `${prompt.id}:assistant-waiting`,
        kind: "assistant",
        body: null,
        detail: input.status ?? optimisticPromptStatusLabel(prompt.status),
        streaming: true,
      });
    } else if (prompt.status === "failed" && (input.status || prompt.errorMessage)) {
      rows.push({
        id: `${prompt.id}:assistant-error`,
        kind: "error",
        body: input.status ?? prompt.errorMessage ?? "Prompt could not be sent.",
      });
    }
  }
  return rows;
}

export function buildPendingHomePromptRows(input: {
  pendingPrompt: CloudChatPendingHomePromptProjection | null;
  workspaceId: string | null;
  sessionId: string | null;
  status: string | null;
  optimisticPrompts: readonly CloudChatOptimisticPrompt[];
}): CloudChatTranscriptRowView[] {
  if (!input.pendingPrompt || !input.workspaceId || input.sessionId) {
    return [];
  }
  const duplicateOptimisticPrompt = input.optimisticPrompts.some((prompt) =>
    prompt.workspaceId === input.workspaceId
    && prompt.sessionId === null
    && textMatches(prompt.text, input.pendingPrompt!.text)
  );
  if (duplicateOptimisticPrompt) {
    return [];
  }
  const preparationStatus = isWorkspacePreparationStatus(
    input.status ?? input.pendingPrompt.errorMessage,
  );
  const failed = !preparationStatus
    && (input.pendingPrompt.status === "failed" || isFailureStatusText(input.status));
  const failureMessage = friendlyCommandStatusMessage(input.pendingPrompt.errorMessage)
    ?? input.status;
  const loading = preparationStatus;
  const rows: CloudChatTranscriptRowView[] = [
    {
      id: `${input.pendingPrompt.id}:user`,
      kind: "user",
      body: input.pendingPrompt.text,
      status: loading ? "Loading" : failed ? "Failed" : null,
    },
  ];
  if (loading || failed) {
    rows.push({
      id: `${input.pendingPrompt.id}:assistant-waiting`,
      kind: failed ? "error" : "assistant",
      body: failed ? failureMessage ?? "Prompt could not be sent." : null,
      detail: failed ? null : input.status ?? "Preparing cloud session.",
      streaming: !failed,
    });
  }
  return rows;
}

export function removeRetryReplacedFailedPrompts(
  prompts: readonly CloudChatOptimisticPrompt[],
  replacement: CloudChatOptimisticPrompt,
): CloudChatOptimisticPrompt[] {
  return prompts.filter((prompt) =>
    prompt.status !== "failed"
    || prompt.workspaceId !== replacement.workspaceId
    || prompt.sessionId !== replacement.sessionId
    || !textMatches(prompt.text, replacement.text)
  );
}

export function textMatches(value: string | null | undefined, expected: string): boolean {
  return normalizePromptText(value) === normalizePromptText(expected);
}

function optimisticPromptToOutboxEntry(
  prompt: CloudChatOptimisticPrompt,
  workspaceId: string,
  sessionId: string | null,
  statusText: string | null,
): PromptOutboxEntry {
  const createdAt = new Date(prompt.createdAt).toISOString();
  const failed = prompt.status === "failed";
  const entry = createPromptOutboxEntry({
    clientPromptId: prompt.id,
    clientSessionId: sessionId ?? prompt.id,
    materializedSessionId: prompt.sessionId,
    workspaceId,
    text: prompt.text,
    blocks: [{ type: "text", text: prompt.text }],
    now: createdAt,
    placement: "transcript",
  });
  return {
    ...entry,
    status: failed ? "failed" : prompt.status === "sending" ? "dispatching" : "accepted",
    deliveryState: failed
      ? "failed_before_dispatch"
      : prompt.status === "sending"
        ? "dispatching"
        : "accepted_running",
    errorMessage: failed ? prompt.errorMessage ?? statusText ?? "Prompt could not be sent." : null,
    updatedAt: createdAt,
    dispatchedAt: prompt.status === "sending" ? createdAt : entry.dispatchedAt,
    acceptedAt: prompt.status === "queued" ? createdAt : entry.acceptedAt,
  };
}

function pendingInteractionToOutboxEntry(
  interaction: CloudPendingInteraction,
  text: string,
  workspaceId: string,
  sessionId: string,
): PromptOutboxEntry {
  const requestedAt = interaction.requestedAt ?? new Date().toISOString();
  const failed = interaction.status === "failed";
  const entry = createPromptOutboxEntry({
    clientPromptId: interaction.requestId,
    clientSessionId: sessionId,
    materializedSessionId: sessionId.startsWith("pending:") ? null : sessionId,
    workspaceId,
    text,
    blocks: [{ type: "text", text }],
    now: requestedAt,
    placement: "transcript",
  });
  return {
    ...entry,
    status: failed ? "failed" : "accepted",
    deliveryState: failed ? "failed_before_dispatch" : "accepted_running",
    errorMessage: failed ? interaction.description ?? "Prompt could not be sent." : null,
    queuedSeq: interaction.requestedSeq,
    updatedAt: requestedAt,
    acceptedAt: failed ? null : requestedAt,
  };
}

function pendingHomePromptToOutboxEntry(
  prompt: CloudChatPendingHomePromptProjection,
  workspaceId: string,
  statusText: string | null,
): PromptOutboxEntry {
  const createdAt = new Date(prompt.createdAt).toISOString();
  const preparationStatus = isWorkspacePreparationStatus(statusText ?? prompt.errorMessage);
  const failed = !preparationStatus
    && (prompt.status === "failed" || isFailureStatusText(statusText));
  const entry = createPromptOutboxEntry({
    clientPromptId: prompt.id,
    clientSessionId: prompt.id,
    materializedSessionId: null,
    workspaceId,
    text: prompt.text,
    blocks: [{ type: "text", text: prompt.text }],
    now: createdAt,
    placement: "transcript",
  });
  return {
    ...entry,
    status: failed ? "failed" : preparationStatus ? "preparing" : "queued",
    deliveryState: failed ? "failed_before_dispatch" : preparationStatus ? "preparing" : "waiting_for_session",
    errorMessage: failed
      ? friendlyCommandStatusMessage(prompt.errorMessage) ?? statusText ?? "Prompt could not be sent."
      : null,
    updatedAt: createdAt,
  };
}

function pendingInteractionPromptText(interaction: CloudPendingInteraction): string | null {
  const payload = interaction.payload;
  if (!payload) {
    return null;
  }
  const text = readString(payload.text)
    ?? readString(payload.prompt)
    ?? readString(payload.message)
    ?? readString(payload.content);
  const trimmed = text?.trim();
  return trimmed ? trimmed : null;
}

function pendingInteractionMatchesOptimisticPrompt(
  prompt: CloudChatOptimisticPrompt,
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

function transcriptHasAgentProgressAfterBaseline(
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

function optimisticPromptStatusLabel(status: CloudChatOptimisticPrompt["status"]): string | null {
  switch (status) {
    case "failed":
      return "Failed";
    case "queued":
      return null;
    case "sending":
    default:
      return "Loading";
  }
}

function isFailureStatusText(status: string | null): boolean {
  return /\b(failed|rejected|expired|superseded|timed out|could not)\b/i.test(status ?? "");
}

function normalizePromptText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
