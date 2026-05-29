import {
  DEFAULT_DIRECT_PROMPT_AGENT_KIND,
  DEFAULT_DIRECT_PROMPT_MODEL_ID,
  type CloudLaunchComposerSelection,
  type LaunchSessionConfigUpdate,
  type PendingConfigChange,
} from "@proliferate/product-domain/chats/cloud/composer-controls";

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

export interface WebCloudSessionDraft {
  id: string;
  workspaceId: string;
  selection: CloudLaunchComposerSelection;
  sessionConfigUpdates: LaunchSessionConfigUpdate[];
  createdAt: number;
}

type StoredPendingConfigChange = PendingConfigChange & { storedAt: number };

export const WEB_CLOUD_SESSION_DRAFT_QUERY_PARAM = "newSession";

const PROMPT_INTENTS_KEY_PREFIX = "proliferate.web.cloudPromptIntents:";
const PENDING_CONFIG_CHANGES_KEY_PREFIX = "proliferate.web.cloudPendingConfigChanges:";
const SESSION_DRAFT_KEY_PREFIX = "proliferate.web.cloudSessionDraft:";
const MAX_PROMPT_INTENT_AGE_MS = 6 * 60 * 60 * 1000;
const MAX_PENDING_CONFIG_CHANGE_AGE_MS = 30 * 60 * 1000;
const MAX_SESSION_DRAFT_AGE_MS = 24 * 60 * 60 * 1000;

const memoryPromptIntents = new Map<string, WebCloudPromptIntent[]>();
const memoryPendingConfigChanges = new Map<string, Record<string, StoredPendingConfigChange>>();
const memorySessionDrafts = new Map<string, WebCloudSessionDraft>();

export function saveWebCloudPromptIntents(
  workspaceId: string,
  prompts: readonly WebCloudPromptIntent[],
): void {
  const freshPrompts = freshPromptIntents(workspaceId, prompts).slice(-20);
  memoryPromptIntents.set(workspaceId, [...freshPrompts]);
  try {
    window.sessionStorage.setItem(promptIntentsKey(workspaceId), JSON.stringify(freshPrompts));
  } catch {
    // The in-memory copy still carries state across same-tab navigation.
  }
}

export function loadWebCloudPromptIntents(workspaceId: string): WebCloudPromptIntent[] {
  const memoryValue = memoryPromptIntents.get(workspaceId);
  if (memoryValue) {
    const fresh = freshPromptIntents(workspaceId, memoryValue);
    memoryPromptIntents.set(workspaceId, fresh);
    return [...fresh];
  }
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(promptIntentsKey(workspaceId));
  } catch {
    return [];
  }
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
  try {
    window.sessionStorage.removeItem(promptIntentsKey(workspaceId));
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

export function saveWebCloudPendingConfigChanges(
  workspaceId: string,
  changes: Record<string, PendingConfigChange>,
): void {
  const now = Date.now();
  const storedEntries = Object.entries(changes)
    .filter(([, change]) => isPendingConfigChange(change))
    .map(([key, change]) => [key, { ...change, storedAt: now }] as const);
  const stored = Object.fromEntries(storedEntries);
  memoryPendingConfigChanges.set(workspaceId, stored);
  try {
    if (storedEntries.length === 0) {
      window.sessionStorage.removeItem(pendingConfigChangesKey(workspaceId));
      return;
    }
    window.sessionStorage.setItem(pendingConfigChangesKey(workspaceId), JSON.stringify(stored));
  } catch {
    // The in-memory copy still carries state across same-tab navigation.
  }
}

export function loadWebCloudPendingConfigChanges(
  workspaceId: string,
): Record<string, PendingConfigChange> {
  const memoryValue = memoryPendingConfigChanges.get(workspaceId);
  if (memoryValue) {
    const fresh = parsePendingConfigChanges(memoryValue);
    memoryPendingConfigChanges.set(workspaceId, stampPendingConfigChanges(fresh));
    return fresh;
  }
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(pendingConfigChangesKey(workspaceId));
  } catch {
    return {};
  }
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    const changes = parsePendingConfigChanges(parsed);
    memoryPendingConfigChanges.set(workspaceId, stampPendingConfigChanges(changes));
    return changes;
  } catch {
    return {};
  }
}

export function createWebCloudSessionDraft(input: {
  workspaceId: string;
  selection: CloudLaunchComposerSelection;
  sessionConfigUpdates: LaunchSessionConfigUpdate[];
}): WebCloudSessionDraft {
  return {
    id: `draft:${Date.now().toString(36)}:${randomSuffix()}`,
    workspaceId: input.workspaceId,
    selection: normalizeSelection(input.selection),
    sessionConfigUpdates: input.sessionConfigUpdates,
    createdAt: Date.now(),
  };
}

export function saveWebCloudSessionDraft(draft: WebCloudSessionDraft): void {
  memorySessionDrafts.set(draftKey(draft.workspaceId, draft.id), draft);
  try {
    window.sessionStorage.setItem(sessionDraftKey(draft.workspaceId, draft.id), JSON.stringify(draft));
  } catch {
    // The in-memory copy still carries state across same-tab navigation.
  }
}

export function loadWebCloudSessionDraft(
  workspaceId: string,
  draftId: string | null,
): WebCloudSessionDraft | null {
  if (!draftId) {
    return null;
  }
  const key = draftKey(workspaceId, draftId);
  const memoryValue = memorySessionDrafts.get(key);
  if (memoryValue) {
    if (isFresh(memoryValue.createdAt, MAX_SESSION_DRAFT_AGE_MS)) {
      return memoryValue;
    }
    memorySessionDrafts.delete(key);
  }
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(sessionDraftKey(workspaceId, draftId));
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    const parsed = parseSessionDraft(JSON.parse(raw), workspaceId, draftId);
    if (!parsed || !isFresh(parsed.createdAt, MAX_SESSION_DRAFT_AGE_MS)) {
      return null;
    }
    memorySessionDrafts.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function loadWebCloudSessionDraftFromSearch(
  workspaceId: string,
  search: string,
): WebCloudSessionDraft | null {
  return loadWebCloudSessionDraft(workspaceId, webCloudSessionDraftIdFromSearch(search));
}

export function clearWebCloudSessionDraft(workspaceId: string, draftId: string | null): void {
  if (!draftId) {
    return;
  }
  memorySessionDrafts.delete(draftKey(workspaceId, draftId));
  try {
    window.sessionStorage.removeItem(sessionDraftKey(workspaceId, draftId));
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

export function webCloudSessionDraftIdFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get(WEB_CLOUD_SESSION_DRAFT_QUERY_PARAM);
  return value?.trim() || null;
}

export function webCloudSessionDraftSearch(draftId: string): string {
  const params = new URLSearchParams();
  params.set(WEB_CLOUD_SESSION_DRAFT_QUERY_PARAM, draftId);
  return `?${params.toString()}`;
}

export function webCloudSessionDraftOptionId(draftId: string): string {
  return `session-draft:${draftId}`;
}

export function isWebCloudSessionDraftOptionId(value: string): boolean {
  return value.startsWith("session-draft:");
}

export function webCloudSessionDraftIdFromOptionId(value: string): string | null {
  return isWebCloudSessionDraftOptionId(value) ? value.slice("session-draft:".length) : null;
}

function promptIntentsKey(workspaceId: string): string {
  return `${PROMPT_INTENTS_KEY_PREFIX}${workspaceId}`;
}

function pendingConfigChangesKey(workspaceId: string): string {
  return `${PENDING_CONFIG_CHANGES_KEY_PREFIX}${workspaceId}`;
}

function sessionDraftKey(workspaceId: string, draftId: string): string {
  return `${SESSION_DRAFT_KEY_PREFIX}${workspaceId}:${draftId}`;
}

function draftKey(workspaceId: string, draftId: string): string {
  return `${workspaceId}:${draftId}`;
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

function parseSessionDraft(
  value: unknown,
  workspaceId: string,
  draftId: string,
): WebCloudSessionDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (stringOrNull(record.id) !== draftId || stringOrNull(record.workspaceId) !== workspaceId) {
    return null;
  }
  return {
    id: draftId,
    workspaceId,
    selection: normalizeSelection(parseSelection(record.selection)),
    sessionConfigUpdates: parseSessionConfigUpdates(record.sessionConfigUpdates),
    createdAt: numberOrDefault(record.createdAt, Date.now()),
  };
}

function parseSelection(value: unknown): CloudLaunchComposerSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return normalizeSelection({});
  }
  const record = value as Record<string, unknown>;
  const rawControlValues = record.controlValues;
  const controlValues: Record<string, string> = {};
  if (rawControlValues && typeof rawControlValues === "object" && !Array.isArray(rawControlValues)) {
    for (const [key, item] of Object.entries(rawControlValues)) {
      const value = stringOrNull(item);
      if (value) {
        controlValues[key] = value;
      }
    }
  }
  return {
    agentKind: stringOrNull(record.agentKind) ?? DEFAULT_DIRECT_PROMPT_AGENT_KIND,
    modelId: stringOrNull(record.modelId),
    modeId: stringOrNull(record.modeId),
    controlValues,
  };
}

function normalizeSelection(value: Partial<CloudLaunchComposerSelection>): CloudLaunchComposerSelection {
  return {
    agentKind: value.agentKind || DEFAULT_DIRECT_PROMPT_AGENT_KIND,
    modelId: value.modelId ?? DEFAULT_DIRECT_PROMPT_MODEL_ID,
    modeId: value.modeId ?? null,
    controlValues: value.controlValues ?? {},
  };
}

function parseSessionConfigUpdates(value: unknown): LaunchSessionConfigUpdate[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const configId = stringOrNull(record.configId);
    const updateValue = stringOrNull(record.value);
    return configId && updateValue ? [{ configId, value: updateValue }] : [];
  });
}

function parsePromptStatus(value: unknown): WebCloudPromptIntentStatus {
  return value === "queued" || value === "failed" ? value : "sending";
}

function parsePendingConfigChanges(value: unknown): Record<string, PendingConfigChange> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const changes: Record<string, PendingConfigChange> = {};
  for (const [key, item] of Object.entries(value)) {
    const change = parsePendingConfigChange(item);
    if (change) {
      changes[key] = change;
    }
  }
  return changes;
}

function stampPendingConfigChanges(
  changes: Record<string, PendingConfigChange>,
): Record<string, StoredPendingConfigChange> {
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(changes).map(([key, change]) => [key, { ...change, storedAt: now }]),
  );
}

function parsePendingConfigChange(value: unknown): PendingConfigChange | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!isFresh(numberOrDefault(record.storedAt, 0), MAX_PENDING_CONFIG_CHANGE_AGE_MS)) {
    return null;
  }
  const sessionId = stringOrNull(record.sessionId);
  const rawConfigId = stringOrNull(record.rawConfigId);
  const updateValue = stringOrNull(record.value);
  if (!sessionId || !rawConfigId || !updateValue) {
    return null;
  }
  return {
    sessionId,
    rawConfigId,
    value: updateValue,
    status: record.status === "sending" ? "sending" : "queued",
    mutationId: numberOrDefault(record.mutationId, 0),
    commandId: stringOrNull(record.commandId),
  };
}

function isPendingConfigChange(value: PendingConfigChange): boolean {
  return Boolean(value.sessionId && value.rawConfigId && value.value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isFresh(createdAt: number, maxAgeMs: number): boolean {
  return Date.now() - createdAt < maxAgeMs;
}

function randomSuffix(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}
