// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSeatMintWorkflow } from "#product/hooks/agents/workflows/use-seat-mint-workflow";

const mocks = vi.hoisted(() => ({
  mintSeatMutate: vi.fn(),
  claimAgentMintToken: vi.fn(),
  closeAgentLoginTerminal: vi.fn(),
  getAgentLoginTerminal: vi.fn(),
  startAgentLoginTerminal: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useMintAgentSeat: () => ({ mutateAsync: mocks.mintSeatMutate }),
}));

vi.mock("#product/lib/access/anyharness/agents", () => ({
  claimAgentMintToken: mocks.claimAgentMintToken,
  closeAgentLoginTerminal: mocks.closeAgentLoginTerminal,
  getAgentLoginTerminal: mocks.getAgentLoginTerminal,
  startAgentLoginTerminal: mocks.startAgentLoginTerminal,
}));

const CONNECTION = { baseUrl: "http://127.0.0.1:8457", authToken: "runtime-token" };
const TERMINAL = { id: "term-1", status: "running", mintStatus: "waiting" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("useSeatMintWorkflow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("overlapping poll ticks claim exactly once — the slow tick must not flip a successful mint to an error", async () => {
    // Tick 0's GET is slow (deferred); tick 1 fires on the interval while it
    // is still in flight and wins the claim. Without the post-await `settled`
    // re-check, the slow tick would claim a second time, catch the runtime's
    // single-shot 409, and overwrite the winner's success with "upload
    // failed" — inviting a duplicate seat.
    const slowGet = deferred<typeof TERMINAL>();
    const fastGet = deferred<typeof TERMINAL>();
    mocks.getAgentLoginTerminal
      .mockImplementationOnce(() => slowGet.promise)
      .mockImplementationOnce(() => fastGet.promise);
    mocks.startAgentLoginTerminal.mockResolvedValue({
      agentLoginTerminal: TERMINAL,
      message: null,
    });
    mocks.claimAgentMintToken.mockResolvedValue({ token: "sk-ant-oat01-token" });
    mocks.mintSeatMutate.mockResolvedValue({ id: "seat-1" });
    mocks.closeAgentLoginTerminal.mockResolvedValue(undefined);
    const onSeatAdded = vi.fn();

    const { result } = renderHook(() =>
      useSeatMintWorkflow({ harnessKind: "claude", connection: CONNECTION, onSeatAdded }),
    );

    await act(async () => {
      await result.current.startMint({ email: "ops@acme.com", planTier: "max" });
    });
    // Tick 0 fired immediately and is now awaiting the slow GET.
    expect(mocks.getAgentLoginTerminal).toHaveBeenCalledTimes(1);

    // The interval fires tick 1 while tick 0 is still in flight.
    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    expect(mocks.getAgentLoginTerminal).toHaveBeenCalledTimes(2);

    // Tick 1 resolves first: ready -> it claims, uploads, and settles.
    await act(async () => {
      fastGet.resolve({ ...TERMINAL, mintStatus: "ready" });
      await Promise.resolve();
    });
    expect(mocks.claimAgentMintToken).toHaveBeenCalledTimes(1);
    expect(onSeatAdded).toHaveBeenCalledWith({ id: "seat-1" });
    expect(result.current.state.phase).toBe("idle");

    // Tick 0's slow GET finally resolves ready too — it must observe the
    // settled flag and do nothing.
    await act(async () => {
      slowGet.resolve({ ...TERMINAL, mintStatus: "ready" });
      await Promise.resolve();
    });
    expect(mocks.claimAgentMintToken).toHaveBeenCalledTimes(1);
    expect(result.current.state.phase).toBe("idle");
    expect(result.current.state.error).toBeNull();
  });
});
