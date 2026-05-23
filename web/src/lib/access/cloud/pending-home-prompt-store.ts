export interface PendingHomePromptSessionConfigUpdate {
  configId: string;
  value: string;
}

export interface PendingHomePrompt {
  id: string;
  text: string;
  agentKind?: string | null;
  modelId: string | null;
  modeId: string | null;
  sessionConfigUpdates?: PendingHomePromptSessionConfigUpdate[];
  createdAt: number;
  status?: "pending" | "failed";
  errorMessage?: string | null;
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
      agentKind: typeof parsed.agentKind === "string" ? parsed.agentKind : null,
      modelId: typeof parsed.modelId === "string" ? parsed.modelId : null,
      modeId: typeof parsed.modeId === "string" ? parsed.modeId : null,
      sessionConfigUpdates: parseSessionConfigUpdates(parsed.sessionConfigUpdates),
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now(),
      status: parsed.status === "failed" ? "failed" : "pending",
      errorMessage: typeof parsed.errorMessage === "string" ? parsed.errorMessage : null,
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

function parseSessionConfigUpdates(value: unknown): PendingHomePromptSessionConfigUpdate[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const configId = typeof record.configId === "string" ? record.configId.trim() : "";
    const updateValue = typeof record.value === "string" ? record.value.trim() : "";
    return configId && updateValue ? [{ configId, value: updateValue }] : [];
  });
}
