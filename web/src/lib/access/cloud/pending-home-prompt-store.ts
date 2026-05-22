export interface PendingHomePrompt {
  id: string;
  text: string;
  modelId: string | null;
  modeId: string | null;
  createdAt: number;
}

const PENDING_HOME_PROMPT_KEY_PREFIX = "proliferate.web.pendingHomePrompt:";
const memoryPendingHomePrompts = new Map<string, PendingHomePrompt>();

export function savePendingHomePrompt(
  workspaceId: string,
  prompt: PendingHomePrompt,
): void {
  memoryPendingHomePrompts.set(workspaceId, prompt);
  try {
    window.sessionStorage.setItem(
      pendingHomePromptKey(workspaceId),
      JSON.stringify(prompt),
    );
  } catch {
    // The in-memory copy still carries the prompt across same-tab navigation.
  }
}

export function loadPendingHomePrompt(workspaceId: string): PendingHomePrompt | null {
  const memoryPrompt = memoryPendingHomePrompts.get(workspaceId);
  if (memoryPrompt) {
    return memoryPrompt;
  }
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(pendingHomePromptKey(workspaceId));
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PendingHomePrompt>;
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

export function clearPendingHomePrompt(workspaceId: string): void {
  memoryPendingHomePrompts.delete(workspaceId);
  try {
    window.sessionStorage.removeItem(pendingHomePromptKey(workspaceId));
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

function pendingHomePromptKey(workspaceId: string): string {
  return `${PENDING_HOME_PROMPT_KEY_PREFIX}${workspaceId}`;
}
