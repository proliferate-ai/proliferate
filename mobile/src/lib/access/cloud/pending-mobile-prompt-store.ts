import * as SecureStore from "expo-secure-store";

import type { MobilePendingPrompt } from "../../../navigation/navigation-model";

const PENDING_PROMPT_PREFIX = "proliferate.mobile.pendingPrompt.";

export async function savePendingMobilePrompt(
  workspaceId: string,
  prompt: MobilePendingPrompt,
): Promise<void> {
  await SecureStore.setItemAsync(promptKey(workspaceId), JSON.stringify(prompt));
}

export async function loadPendingMobilePrompt(
  workspaceId: string,
): Promise<MobilePendingPrompt | null> {
  const raw = await SecureStore.getItemAsync(promptKey(workspaceId));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<MobilePendingPrompt>;
    if (typeof parsed.id !== "string" || typeof parsed.text !== "string") {
      return null;
    }
    return {
      id: parsed.id,
      text: parsed.text,
      modelId: typeof parsed.modelId === "string" ? parsed.modelId : null,
      modeId: typeof parsed.modeId === "string" ? parsed.modeId : null,
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export async function clearPendingMobilePrompt(workspaceId: string): Promise<void> {
  await SecureStore.deleteItemAsync(promptKey(workspaceId));
}

function promptKey(workspaceId: string): string {
  return `${PENDING_PROMPT_PREFIX}${workspaceId}`;
}
