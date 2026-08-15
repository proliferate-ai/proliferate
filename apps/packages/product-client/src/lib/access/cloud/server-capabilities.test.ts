import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchMinDesktopVersionGate,
  fetchServerCapabilities,
} from "#product/lib/access/cloud/server-capabilities";
import {
  EXPECTED_CONTROL_PLANE_PROBE_TIMEOUT_ERROR_NAME,
} from "#product/domain/telemetry/control-plane-probe-timeout";

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

describe("fetchMinDesktopVersionGate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("parses minDesktopVersion and the explicit enforcement opt-in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          minDesktopVersion: "0.4.0",
          minDesktopVersionEnforced: true,
        }),
      }),
    );

    const gate = await fetchMinDesktopVersionGate("http://control-plane.test");

    expect(gate).toEqual({ minDesktopVersion: "0.4.0", minDesktopVersionEnforced: true });
  });

  it("fails open (enforced: false) when the flag is absent (older server)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ minDesktopVersion: "0.4.0" }),
      }),
    );

    const gate = await fetchMinDesktopVersionGate("http://control-plane.test");

    expect(gate).toEqual({ minDesktopVersion: "0.4.0", minDesktopVersionEnforced: false });
  });

  it("returns null when the body doesn't structurally carry minDesktopVersion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "ok" }) }),
    );

    expect(await fetchMinDesktopVersionGate("http://control-plane.test")).toBeNull();
  });

  it("returns null on a non-ok response or network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await fetchMinDesktopVersionGate("http://control-plane.test")).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await fetchMinDesktopVersionGate("http://control-plane.test")).toBeNull();
  });
});
