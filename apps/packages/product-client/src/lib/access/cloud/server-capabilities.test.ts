import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchServerCapabilities } from "#product/lib/access/cloud/server-capabilities";
import {
  EXPECTED_CONTROL_PLANE_PROBE_TIMEOUT_ERROR_NAME,
} from "@proliferate/product-domain/telemetry/control-plane-probe-timeout";

describe("server capabilities", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("marks a hung metadata probe as an expected timeout", async () => {
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

    const capabilities = fetchServerCapabilities("http://control-plane.test");

    await vi.advanceTimersByTimeAsync(2_500);

    await expect(capabilities).resolves.toBeNull();
    expect(signal?.aborted).toBe(true);
    expect(abortReason).toMatchObject({
      name: EXPECTED_CONTROL_PLANE_PROBE_TIMEOUT_ERROR_NAME,
    });
  });
});
