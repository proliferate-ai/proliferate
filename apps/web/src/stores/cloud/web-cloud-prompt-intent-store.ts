import {
  isFresh,
  numberOrDefault,
  readSessionStorageValue,
  removeSessionStorageValue,
  stringOrNull,
  writeSessionStorageValue,
} from "./web-cloud-state-storage";

export type WebCloudPromptIntentStatus = "sending" | "queued" | "failed";

export interface WebCloudPromptIntent {
  id: string;
  workspaceId: string;
  sessionId: string | null;
  text: string;
  baseTranscriptSeq: number;
  status: WebCloudPromptIntentStatus;
  commandId?: string | null;
  errorMessage?: string | null;
  createdAt: number;
}

const PROMPT_INTENTS_KEY_PREFIX = "proliferate.web.cloudPromptIntents:";
const MAX_PROMPT_INTENT_AGE_MS = 6 * 60 * 60 * 1000;

const memoryPromptIntents = new Map<string, WebCloudPromptIntent[]>();

export function saveWebCloudPromptIntents(
  workspaceId: string,
  prompts: readonly WebCloudPromptIntent[],
): void {
  const freshPrompts = freshPromptIntents(workspaceId, prompts).slice(-20);
  memoryPromptIntents.set(workspaceId, [...freshPrompts]);
  writeSessionStorageValue(promptIntentsKey(workspaceId), JSON.stringify(freshPrompts));
}

export function loadWebCloudPromptIntents(workspaceId: string): WebCloudPromptIntent[] {
  const memoryValue = memoryPromptIntents.get(workspaceId);
  if (memoryValue) {
    const fresh = freshPromptIntents(workspaceId, memoryValue);
    memoryPromptIntents.set(workspaceId, fresh);
    return [...fresh];
  }
  const raw = readSessionStorageValue(promptIntentsKey(workspaceId));
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const prompts = freshPromptIntents(workspaceId, parsed.flatMap(parsePromptIntent));
    memoryPromptIntents.set(workspaceId, prompts);
    return [...prompts];
  } catch {
    return [];
  }
}

export function clearWebCloudPromptIntents(workspaceId: string): void {
  memoryPromptIntents.delete(workspaceId);
  removeSessionStorageValue(promptIntentsKey(workspaceId));
}

function promptIntentsKey(workspaceId: string): string {
  return `${PROMPT_INTENTS_KEY_PREFIX}${workspaceId}`;
}

function freshPromptIntents(
  workspaceId: string,
  prompts: readonly WebCloudPromptIntent[],
): WebCloudPromptIntent[] {
  return prompts
    .filter((prompt) => prompt.workspaceId === workspaceId)
    .filter((prompt) => isFresh(prompt.createdAt, MAX_PROMPT_INTENT_AGE_MS));
}

function parsePromptIntent(value: unknown): WebCloudPromptIntent[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const record = value as Record<string, unknown>;
  const id = stringOrNull(record.id);
  const workspaceId = stringOrNull(record.workspaceId);
  const text = stringOrNull(record.text);
  if (!id || !workspaceId || !text) {
    return [];
  }
  return [{
    id,
    workspaceId,
    sessionId: stringOrNull(record.sessionId),
    text,
    baseTranscriptSeq: numberOrDefault(record.baseTranscriptSeq, 0),
    status: parsePromptStatus(record.status),
    commandId: stringOrNull(record.commandId),
    errorMessage: stringOrNull(record.errorMessage),
    createdAt: numberOrDefault(record.createdAt, Date.now()),
  }];
}

function parsePromptStatus(value: unknown): WebCloudPromptIntentStatus {
  return value === "queued" || value === "failed" ? value : "sending";
}
