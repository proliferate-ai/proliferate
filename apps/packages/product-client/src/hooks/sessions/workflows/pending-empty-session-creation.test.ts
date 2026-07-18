import { describe, expect, it, vi } from "vitest";
import { AnyHarnessError } from "@anyharness/sdk";
import type { ProductStorage } from "@proliferate/product-client/host/product-host";
import type { ProductStorageContext } from "#product/lib/infra/persistence/product-storage";
import {
  clearPendingEmptySessionCreation,
  clearPendingEmptySessionCreationAfterFailure,
  isAmbiguousSessionCreateFailure,
  loadPendingEmptySessionCreations,
  persistPendingEmptySessionCreation,
  preparePendingEmptySessionCreation,
  resumePendingEmptySessionCreations,
  type PendingEmptySessionCreation,
} from "#product/hooks/sessions/workflows/pending-empty-session-creation";

const ENTRY: PendingEmptySessionCreation = {
  workspaceId: "workspace-1",
  clientSessionId: "client-session:claude:optimistic-1",
  runtimeSessionId: "01234567-89ab-4def-8123-456789abcdef",
  agentKind: "claude",
  modelId: "sonnet",
  modeId: "default",
  launchControlValues: { thinking: "high" },
  frozenLiveControlValues: { thinking: "high", effort: "medium" },
  subagentsEnabled: false,
  replacesSessionId: null,
  createdAt: 42,
};

describe("pending empty-session creation", () => {
  it("prepares and persists the bundled-local lifecycle with frozen inputs", async () => {
    const context = memoryStorageContext();
    const lifecycle = preparePendingEmptySessionCreation(context, {
      workspaceId: ENTRY.workspaceId,
      clientSessionId: ENTRY.clientSessionId,
      runtimeSessionId: ENTRY.runtimeSessionId,
      agentKind: ENTRY.agentKind,
      modelId: ENTRY.modelId,
      modeId: ENTRY.modeId,
      launchControlValues: ENTRY.launchControlValues,
      frozenLiveControlValues: ENTRY.frozenLiveControlValues,
      subagentsEnabled: ENTRY.subagentsEnabled,
      replacesSessionId: ENTRY.replacesSessionId,
    });

    expect(lifecycle).toMatchObject({
      runtimeSessionId: ENTRY.runtimeSessionId,
      subagentsEnabled: ENTRY.subagentsEnabled,
    });
    await lifecycle?.persist();
    await expect(loadPendingEmptySessionCreations(context, ENTRY.workspaceId))
      .resolves.toEqual([expect.objectContaining({
        ...ENTRY,
        createdAt: expect.any(Number),
      })]);
    await lifecycle?.acknowledge();
    await expect(loadPendingEmptySessionCreations(context, ENTRY.workspaceId))
      .resolves.toEqual([]);
  });

  it("does not prepare caller-selected ids for version-skewed targets", () => {
    const context = memoryStorageContext();
    expect(preparePendingEmptySessionCreation(context, {
      workspaceId: "cloud:workspace-1",
      clientSessionId: ENTRY.clientSessionId,
      agentKind: ENTRY.agentKind,
      modelId: ENTRY.modelId,
      modeId: ENTRY.modeId,
      frozenLiveControlValues: ENTRY.frozenLiveControlValues,
      subagentsEnabled: ENTRY.subagentsEnabled,
    })).toBeNull();
  });

  it("resumes with the original ids and frozen launch inputs, then acknowledges once", async () => {
    const context = memoryStorageContext();

    // First renderer: the intent is durable, then the POST loses its response
    // during reload and therefore never acknowledges the entry.
    await persistPendingEmptySessionCreation(context, ENTRY);

    // Fresh renderer: bootstrap uses the exact same client alias and server
    // UUID. Its successful create response acknowledges the durable intent.
    const create = vi.fn(async (options) => {
      expect(options).toMatchObject({
        workspaceId: ENTRY.workspaceId,
        clientSessionId: ENTRY.clientSessionId,
        runtimeSessionId: ENTRY.runtimeSessionId,
        agentKind: ENTRY.agentKind,
        modelId: ENTRY.modelId,
        resolvedModeId: ENTRY.modeId,
        launchControlValues: ENTRY.launchControlValues,
        frozenLiveControlValues: ENTRY.frozenLiveControlValues,
        subagentsEnabled: ENTRY.subagentsEnabled,
        reuseInFlightEmptySession: false,
        preserveProjectedSessionOnCreateFailure: true,
      });
      await clearPendingEmptySessionCreation(
        context,
        ENTRY.workspaceId,
        ENTRY.runtimeSessionId,
      );
      return ENTRY.clientSessionId;
    });

    await expect(resumePendingEmptySessionCreations(
      context,
      ENTRY.workspaceId,
      () => true,
      create,
    )).resolves.toEqual({ resumed: 1, unresolved: 0 });
    expect(create).toHaveBeenCalledOnce();
    await expect(loadPendingEmptySessionCreations(context, ENTRY.workspaceId))
      .resolves.toEqual([]);

    await expect(resumePendingEmptySessionCreations(
      context,
      ENTRY.workspaceId,
      () => true,
      create,
    )).resolves.toEqual({ resumed: 0, unresolved: 0 });
    expect(create).toHaveBeenCalledOnce();
  });

  it("keeps bootstrap usable while an ambiguous replay remains pending", async () => {
    const context = memoryStorageContext();
    await persistPendingEmptySessionCreation(context, ENTRY);
    const createError = new TypeError("Failed to fetch");
    const create = vi.fn(async () => { throw createError; });

    await expect(resumePendingEmptySessionCreations(
      context,
      ENTRY.workspaceId,
      () => true,
      create,
    )).resolves.toEqual({ resumed: 0, unresolved: 1 });
    await expect(loadPendingEmptySessionCreations(context, ENTRY.workspaceId))
      .resolves.toEqual([ENTRY]);
    expect(context.captureException).toHaveBeenCalledWith(createError, {
      tags: {
        domain: "pending_empty_session_creation",
        action: "resume",
      },
    });
  });

  it("serializes concurrent writes so separate empty tabs are not lost", async () => {
    const context = memoryStorageContext();
    const second: PendingEmptySessionCreation = {
      ...ENTRY,
      clientSessionId: "client-session:codex:optimistic-2",
      runtimeSessionId: "11234567-89ab-4def-8123-456789abcdef",
      agentKind: "codex",
      modelId: "gpt-5",
      createdAt: 43,
    };

    await Promise.all([
      persistPendingEmptySessionCreation(context, ENTRY),
      persistPendingEmptySessionCreation(context, second),
    ]);

    await expect(loadPendingEmptySessionCreations(context, ENTRY.workspaceId))
      .resolves.toEqual([ENTRY, second]);
  });

  it("retains unknown-commit transport and server failures for a later resume", () => {
    expect(isAmbiguousSessionCreateFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isAmbiguousSessionCreateFailure(new DOMException("aborted", "AbortError")))
      .toBe(true);
    expect(isAmbiguousSessionCreateFailure(new AnyHarnessError({
      type: "about:blank",
      title: "Agent startup failed",
      status: 503,
    }))).toBe(true);
    expect(isAmbiguousSessionCreateFailure(new AnyHarnessError({
      type: "about:blank",
      title: "Invalid request",
      status: 400,
    }))).toBe(false);
    expect(isAmbiguousSessionCreateFailure(new Error("400 invalid request"))).toBe(false);
  });

  it("clears stale ownership after a terminal replay conflict", async () => {
    const context = memoryStorageContext();
    await persistPendingEmptySessionCreation(context, ENTRY);

    await clearPendingEmptySessionCreationAfterFailure(
      context,
      ENTRY,
      new Error("409 session id conflicts with a dismissed session"),
    );

    await expect(loadPendingEmptySessionCreations(context, ENTRY.workspaceId))
      .resolves.toEqual([]);
  });

  it("fails bootstrap closed when the durable ledger cannot be read", async () => {
    const readError = new Error("preferences unavailable");
    const context: ProductStorageContext = {
      storage: {
        getItem: async () => { throw readError; },
        setItem: async () => undefined,
        removeItem: async () => undefined,
      },
      captureException: vi.fn(),
    };
    const create = vi.fn(async () => ENTRY.clientSessionId);

    await expect(resumePendingEmptySessionCreations(
      context,
      ENTRY.workspaceId,
      () => true,
      create,
    )).rejects.toBe(readError);
    expect(create).not.toHaveBeenCalled();
    expect(context.captureException).toHaveBeenCalledOnce();
  });

  it("fails bootstrap closed when the durable ledger is malformed", async () => {
    const context: ProductStorageContext = {
      storage: {
        getItem: async () => "{not valid json",
        setItem: async () => undefined,
        removeItem: async () => undefined,
      },
      captureException: vi.fn(),
    };
    const create = vi.fn(async () => ENTRY.clientSessionId);

    await expect(resumePendingEmptySessionCreations(
      context,
      ENTRY.workspaceId,
      () => true,
      create,
    )).rejects.toBeInstanceOf(SyntaxError);
    expect(create).not.toHaveBeenCalled();
    expect(context.captureException).toHaveBeenCalledOnce();
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
