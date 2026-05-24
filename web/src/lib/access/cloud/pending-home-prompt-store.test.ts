import { afterEach, describe, expect, it } from "vitest";

import {
  clearPendingHomePrompt,
  loadPendingHomePrompt,
  savePendingHomePrompt,
} from "./pending-home-prompt-store";

class MemorySessionStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function installWindowStorage(storage = new MemorySessionStorage()): MemorySessionStorage {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { sessionStorage: storage },
  });
  return storage;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("pending home prompt store", () => {
  it("preserves organization owner context from session storage", () => {
    const storage = installWindowStorage();
    storage.setItem(
      "proliferate.web.pendingHomePrompt:workspace-1",
      JSON.stringify({
        id: "prompt-1",
        text: "ship it",
        agentKind: "claude",
        modelId: "sonnet",
        modeId: "code",
        ownerScope: "organization",
        organizationId: "org-1",
        sessionConfigUpdates: [
          { configId: "effort", value: "high" },
          { configId: "", value: "ignored" },
        ],
        createdAt: 123,
      }),
    );

    expect(loadPendingHomePrompt("workspace-1")).toMatchObject({
      id: "prompt-1",
      text: "ship it",
      ownerScope: "organization",
      organizationId: "org-1",
      sessionConfigUpdates: [{ configId: "effort", value: "high" }],
      status: "pending",
    });
  });

  it("defaults missing owner context to personal and clears persisted prompts", () => {
    installWindowStorage();

    savePendingHomePrompt("workspace-2", {
      id: "prompt-2",
      text: "hello",
      modelId: null,
      modeId: null,
      createdAt: 456,
    });

    expect(loadPendingHomePrompt("workspace-2")).toMatchObject({
      id: "prompt-2",
      ownerScope: "personal",
      organizationId: null,
    });

    clearPendingHomePrompt("workspace-2");

    expect(loadPendingHomePrompt("workspace-2")).toBeNull();
  });
});
