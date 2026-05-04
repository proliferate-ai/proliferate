// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useComposerSubmitGate } from "./use-composer-submit-gate";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useComposerSubmitGate", () => {
  afterEach(() => {
    cleanup();
  });

  it("blocks synchronous duplicate runs while an action is pending", async () => {
    const gate = deferred();
    const action = vi.fn(() => gate.promise);
    const { result } = renderHook(() => useComposerSubmitGate());

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.run(action);
      second = result.current.run(action);
    });

    expect(action).toHaveBeenCalledTimes(1);
    await expect(second).resolves.toBe(false);

    await act(async () => {
      gate.resolve();
      await expect(first).resolves.toBe(true);
    });
  });

  it("reports submitting while the action is pending", async () => {
    const gate = deferred();
    const { result } = renderHook(() => useComposerSubmitGate());

    let run!: Promise<boolean>;
    act(() => {
      run = result.current.run(() => gate.promise);
    });

    expect(result.current.isSubmitting).toBe(true);

    await act(async () => {
      gate.resolve();
      await run;
    });

    expect(result.current.isSubmitting).toBe(false);
  });

  it("allows another run after settlement", async () => {
    const { result } = renderHook(() => useComposerSubmitGate());
    const action = vi.fn();

    await act(async () => {
      await expect(result.current.run(action)).resolves.toBe(true);
    });
    await act(async () => {
      await expect(result.current.run(action)).resolves.toBe(true);
    });

    expect(action).toHaveBeenCalledTimes(2);
  });

  it("unlocks and propagates action failures", async () => {
    const { result } = renderHook(() => useComposerSubmitGate());
    const error = new Error("submit failed");
    const failingAction = vi.fn(() => {
      throw error;
    });
    const nextAction = vi.fn();

    await act(async () => {
      await expect(result.current.run(failingAction)).rejects.toThrow("submit failed");
    });
    await act(async () => {
      await expect(result.current.run(nextAction)).resolves.toBe(true);
    });

    expect(failingAction).toHaveBeenCalledTimes(1);
    expect(nextAction).toHaveBeenCalledTimes(1);
    expect(result.current.isSubmitting).toBe(false);
  });
});
