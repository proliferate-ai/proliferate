import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductStorage } from "@proliferate/product-client/host/product-host";
import type { ProductStorageContext } from "#product/lib/infra/persistence/product-storage";
import { persistPendingEmptySessionCreation } from "#product/hooks/sessions/workflows/pending-empty-session-creation";
import {
  clearWorkspaceBootstrappedInSession,
  hasWorkspaceBootstrappedInSession,
} from "#product/hooks/workspaces/lifecycle/workspace-bootstrap-memory";
import { resumePendingEmptySessionCreationForBootstrap } from "#product/hooks/workspaces/workflows/workspace-bootstrap-pending-empty-session";

const WORKSPACE_ID = "workspace-bootstrap-pending-create";

afterEach(() => {
  clearWorkspaceBootstrappedInSession(WORKSPACE_ID);
});

describe("resumePendingEmptySessionCreationForBootstrap", () => {
  it("finishes bootstrap while an ambiguous replay remains retryable", async () => {
    const context = memoryStorageContext();
    await persistPendingEmptySessionCreation(context, {
      workspaceId: WORKSPACE_ID,
      clientSessionId: "client-session:claude:optimistic-1",
      runtimeSessionId: "01234567-89ab-4def-8123-456789abcdef",
      agentKind: "claude",
      modelId: "sonnet",
      modeId: null,
      frozenLiveControlValues: {},
      subagentsEnabled: true,
      replacesSessionId: null,
      createdAt: 42,
    });

    const createError = new TypeError("Failed to fetch");
    const createEmptySession = vi.fn(async () => { throw createError; });
    await expect(resumePendingEmptySessionCreationForBootstrap({
      storageContext: context,
      workspaceId: WORKSPACE_ID,
      startedAt: performance.now(),
      isCurrent: () => true,
      createEmptySession,
    })).resolves.toBe(true);

    expect(createEmptySession).toHaveBeenCalledOnce();
    expect(hasWorkspaceBootstrappedInSession(WORKSPACE_ID)).toBe(true);
  });
});

function memoryStorageContext(): ProductStorageContext {
  const values = new Map<string, string>();
  const storage: ProductStorage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
  return { storage, captureException: vi.fn() };
}
