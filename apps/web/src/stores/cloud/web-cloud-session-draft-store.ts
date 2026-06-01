import {
  DEFAULT_DIRECT_PROMPT_AGENT_KIND,
  DEFAULT_DIRECT_PROMPT_MODEL_ID,
  type CloudLaunchComposerSelection,
  type LaunchSessionConfigUpdate,
} from "@proliferate/product-domain/chats/cloud/composer-controls";

import {
  isFresh,
  numberOrDefault,
  randomSuffix,
  readSessionStorageValue,
  removeSessionStorageValue,
  stringOrNull,
  writeSessionStorageValue,
} from "../../lib/access/browser/web-cloud-state-storage";

export interface WebCloudSessionDraft {
  id: string;
  workspaceId: string;
  selection: CloudLaunchComposerSelection;
  sessionConfigUpdates: LaunchSessionConfigUpdate[];
  createdAt: number;
}

export const WEB_CLOUD_SESSION_DRAFT_QUERY_PARAM = "newSession";

const SESSION_DRAFT_KEY_PREFIX = "proliferate.web.cloudSessionDraft:";
const MAX_SESSION_DRAFT_AGE_MS = 24 * 60 * 60 * 1000;

const memorySessionDrafts = new Map<string, WebCloudSessionDraft>();

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
  writeSessionStorageValue(sessionDraftKey(draft.workspaceId, draft.id), JSON.stringify(draft));
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
  const raw = readSessionStorageValue(sessionDraftKey(workspaceId, draftId));
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
  removeSessionStorageValue(sessionDraftKey(workspaceId, draftId));
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

function sessionDraftKey(workspaceId: string, draftId: string): string {
  return `${SESSION_DRAFT_KEY_PREFIX}${workspaceId}:${draftId}`;
}

function draftKey(workspaceId: string, draftId: string): string {
  return `${workspaceId}:${draftId}`;
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
