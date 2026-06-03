import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkControlPlaneReachable,
  getLastKnownControlPlaneReachable,
} from "./health";

describe("control plane health", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("records a reachable control plane when health responds", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
    } as Response));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkControlPlaneReachable()).resolves.toBe(true);

    expect(getLastKnownControlPlaneReachable()).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/health$/),
      expect.objectContaining({
        headers: { Accept: "application/json" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("times out a hung health request so boot can fall back", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const reachable = checkControlPlaneReachable();

    await vi.advanceTimersByTimeAsync(2_500);

    await expect(reachable).resolves.toBe(false);
    expect(signal?.aborted).toBe(true);
    expect(getLastKnownControlPlaneReachable()).toBe(false);
  });
});
