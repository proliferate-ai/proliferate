import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkControlPlaneReachable,
  getLastKnownControlPlaneReachable,
} from "#product/lib/access/cloud/health";
import {
  EXPECTED_CONTROL_PLANE_PROBE_TIMEOUT_ERROR_NAME,
} from "@proliferate/product-domain/telemetry/control-plane-probe-timeout";

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

    await expect(checkControlPlaneReachable("http://control-plane.test")).resolves.toBe(true);

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
    let abortReason: unknown;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          abortReason = signal?.reason;
          reject(abortReason);
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const reachable = checkControlPlaneReachable("http://control-plane.test");

    await vi.advanceTimersByTimeAsync(2_500);

    await expect(reachable).resolves.toBe(false);
    expect(signal?.aborted).toBe(true);
    expect(abortReason).toMatchObject({
      name: EXPECTED_CONTROL_PLANE_PROBE_TIMEOUT_ERROR_NAME,
    });
    expect(getLastKnownControlPlaneReachable()).toBe(false);
  });
});
