import { describe, expect, it, vi, afterEach } from "vitest";
import {
  waitForSessionMaterialization,
  type SessionMaterializationDeps,
} from "./session-materialization";

describe("waitForSessionMaterialization", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves immediately when a materialized id already exists", async () => {
    const deps: SessionMaterializationDeps = {
      getMaterializedSessionId: () => "runtime-a",
      subscribeToMaterializedSessionId: vi.fn(),
    };

    await expect(waitForSessionMaterialization("client-a", deps))
      .resolves
      .toBe("runtime-a");
    expect(deps.subscribeToMaterializedSessionId).not.toHaveBeenCalled();
  });

  it("resolves from the injected subscription", async () => {
    vi.useFakeTimers();
    const listenerRef: {
      current: ((materializedSessionId: string | null) => void) | null;
    } = { current: null };
    const unsubscribe = vi.fn();
    const deps: SessionMaterializationDeps = {
      getMaterializedSessionId: () => null,
      subscribeToMaterializedSessionId: (_clientSessionId, onChange) => {
        listenerRef.current = onChange;
        return unsubscribe;
      },
    };

    const pending = waitForSessionMaterialization("client-a", deps, {
      timeoutMs: 1_000,
    });
    listenerRef.current?.("runtime-a");

    await expect(pending).resolves.toBe("runtime-a");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("rechecks after subscribing to cover materialization races", async () => {
    vi.useFakeTimers();
    let current: string | null = null;
    const unsubscribe = vi.fn();
    const deps: SessionMaterializationDeps = {
      getMaterializedSessionId: () => current,
      subscribeToMaterializedSessionId: () => {
        current = "runtime-a";
        return unsubscribe;
      },
    };

    await expect(waitForSessionMaterialization("client-a", deps, {
      timeoutMs: 1_000,
    })).resolves.toBe("runtime-a");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("rejects and unsubscribes on timeout", async () => {
    vi.useFakeTimers();
    const unsubscribe = vi.fn();
    const deps: SessionMaterializationDeps = {
      getMaterializedSessionId: () => null,
      subscribeToMaterializedSessionId: () => unsubscribe,
    };

    const pending = expect(waitForSessionMaterialization("client-a", deps, {
      timeoutMs: 1_000,
    })).rejects.toThrow("Session is still starting. Try again in a moment.");

    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
