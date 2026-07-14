// @vitest-environment jsdom

import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductEntry } from "@proliferate/product-client/host/product-host";

const handoffMocks = vi.hoisted(() => ({
  markDevDesktopHandoffOpened: vi.fn(),
  takeDevDesktopHandoff: vi.fn(),
  isMainTauriWebviewAvailable: vi.fn(),
  revealCurrentWindow: vi.fn(),
}));

vi.mock("@/lib/access/cloud/dev-desktop-handoff", () => ({
  markDevDesktopHandoffOpened: handoffMocks.markDevDesktopHandoffOpened,
  takeDevDesktopHandoff: handoffMocks.takeDevDesktopHandoff,
}));

vi.mock("@/lib/access/tauri/window", () => ({
  isMainTauriWebviewAvailable: handoffMocks.isMainTauriWebviewAvailable,
  revealCurrentWindow: handoffMocks.revealCurrentWindow,
}));

import { subscribeDevDesktopHandoffs } from "./dev-desktop-handoff-source";

describe("subscribeDevDesktopHandoffs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handoffMocks.markDevDesktopHandoffOpened.mockResolvedValue(undefined);
    handoffMocks.takeDevDesktopHandoff.mockResolvedValue(null);
    handoffMocks.isMainTauriWebviewAvailable.mockReturnValue(true);
    handoffMocks.revealCurrentWindow.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not consume handoffs outside the Tauri Desktop runtime", async () => {
    handoffMocks.isMainTauriWebviewAvailable.mockReturnValue(false);
    const unsubscribe = subscribeDevDesktopHandoffs(
      "https://api.example.test",
      vi.fn(),
    );

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(handoffMocks.takeDevDesktopHandoff).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("emits a normalized entry and reports the handoff as opened", async () => {
    handoffMocks.takeDevDesktopHandoff.mockResolvedValueOnce({
      id: "handoff-source-1",
      url: "proliferate-local://join/org-1",
      createdAt: "2026-06-25T00:00:00.000Z",
    });
    const received: ProductEntry[] = [];
    const unsubscribe = subscribeDevDesktopHandoffs(
      "https://api.example.test",
      (entry) => received.push(entry),
    );

    await waitFor(() => {
      expect(received).toEqual([{ kind: "organization-join", organizationId: "org-1" }]);
    });
    expect(handoffMocks.markDevDesktopHandoffOpened).toHaveBeenCalledWith(
      "https://api.example.test",
      "handoff-source-1",
    );
    expect(handoffMocks.revealCurrentWindow).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("stops an in-flight poll on unsubscribe", async () => {
    let resolveHandoff!: (value: null) => void;
    handoffMocks.takeDevDesktopHandoff.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveHandoff = resolve;
      }),
    );
    const listener = vi.fn();
    const unsubscribe = subscribeDevDesktopHandoffs(
      "https://api.example.test",
      listener,
    );

    await waitFor(() => {
      expect(handoffMocks.takeDevDesktopHandoff).toHaveBeenCalledTimes(1);
    });
    const signal = handoffMocks.takeDevDesktopHandoff.mock.calls[0]?.[1];
    unsubscribe();
    expect(signal?.aborted).toBe(true);
    resolveHandoff(null);
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
  });
});
