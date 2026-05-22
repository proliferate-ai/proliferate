import type { MobilePendingPrompt } from "../../../navigation/navigation-model";
import {
  deleteMobileStorageItem,
  getMobileStorageItem,
  setMobileStorageItem,
} from "../mobile-storage";

const PENDING_PROMPT_PREFIX = "proliferate.mobile.pendingPrompt.";
const PENDING_PROMPT_VERSION = 1;
const PENDING_PROMPT_TTL_MS = 24 * 60 * 60 * 1000;

interface StoredPendingPrompt {
  version: number;
  ownerUserId: string;
  prompt: MobilePendingPrompt;
  savedAt: number;
}

export async function savePendingMobilePrompt(
  workspaceId: string,
  ownerUserId: string,
  prompt: MobilePendingPrompt,
): Promise<void> {
  const record: StoredPendingPrompt = {
    version: PENDING_PROMPT_VERSION,
    ownerUserId,
    prompt,
    savedAt: Date.now(),
  };
  await Promise.all([
    setMobileStorageItem(promptKey(workspaceId, ownerUserId), JSON.stringify(record)),
    deleteMobileStorageItem(legacyPromptKey(workspaceId)),
  ]);
}

export async function loadPendingMobilePrompt(
  workspaceId: string,
  ownerUserId: string,
): Promise<MobilePendingPrompt | null> {
  const key = promptKey(workspaceId, ownerUserId);
  const raw = await getMobileStorageItem(key);
  if (!raw) {
    return migrateLegacyPendingPrompt(workspaceId, ownerUserId);
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredPendingPrompt>;
    if (
      parsed.version !== PENDING_PROMPT_VERSION
      || parsed.ownerUserId !== ownerUserId
      || !parsed.prompt
      || !isPromptFresh(parsed.savedAt)
    ) {
      await deleteMobileStorageItem(key);
      return null;
    }
    const prompt = parsePendingPrompt(parsed.prompt);
    if (!prompt) {
      await deleteMobileStorageItem(key);
      return null;
    }
    return prompt;
  } catch {
    await deleteMobileStorageItem(key);
    return null;
  }
}

async function migrateLegacyPendingPrompt(
  workspaceId: string,
  ownerUserId: string,
): Promise<MobilePendingPrompt | null> {
  const legacyKey = legacyPromptKey(workspaceId);
  const raw = await getMobileStorageItem(legacyKey);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      await deleteMobileStorageItem(legacyKey);
      return null;
    }
    const record = parsed as Partial<StoredPendingPrompt>;
    const prompt = parsePendingPrompt(record.prompt ?? parsed);
    if (!prompt) {
      await deleteMobileStorageItem(legacyKey);
      return null;
    }
    await savePendingMobilePrompt(workspaceId, ownerUserId, prompt);
    return prompt;
  } catch {
    await deleteMobileStorageItem(legacyKey);
    return null;
  }
}

export async function clearPendingMobilePrompt(
  workspaceId: string,
  ownerUserId: string,
): Promise<void> {
  await Promise.all([
    deleteMobileStorageItem(promptKey(workspaceId, ownerUserId)),
    deleteMobileStorageItem(legacyPromptKey(workspaceId)),
  ]);
}

function promptKey(workspaceId: string, ownerUserId: string): string {
  return `${PENDING_PROMPT_PREFIX}${encodeURIComponent(ownerUserId)}.${workspaceId}`;
}

function legacyPromptKey(workspaceId: string): string {
  return `${PENDING_PROMPT_PREFIX}${workspaceId}`;
}

function parsePendingPrompt(value: unknown): MobilePendingPrompt | null {
  const parsed = value as Partial<MobilePendingPrompt>;
  if (!parsed || typeof parsed.id !== "string" || typeof parsed.text !== "string") {
    return null;
  }
  return {
    id: parsed.id,
    text: parsed.text,
    modelId: typeof parsed.modelId === "string" ? parsed.modelId : null,
    modeId: typeof parsed.modeId === "string" ? parsed.modeId : null,
    createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now(),
    dispatchedSessionId:
      typeof parsed.dispatchedSessionId === "string" ? parsed.dispatchedSessionId : null,
    failedAt: typeof parsed.failedAt === "number" ? parsed.failedAt : null,
    failureMessage:
      typeof parsed.failureMessage === "string" ? parsed.failureMessage : null,
  };
}

function isPromptFresh(savedAt: unknown): boolean {
  return typeof savedAt === "number" && Date.now() - savedAt <= PENDING_PROMPT_TTL_MS;
}
