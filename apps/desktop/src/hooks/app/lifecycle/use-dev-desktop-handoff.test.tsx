// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useDevDesktopHandoff } from "@/hooks/app/lifecycle/use-dev-desktop-handoff";

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

describe("useDevDesktopHandoff", () => {
  beforeEach(() => {
    handoffMocks.markDevDesktopHandoffOpened.mockReset();
    handoffMocks.takeDevDesktopHandoff.mockReset();
    handoffMocks.isMainTauriWebviewAvailable.mockReset();
    handoffMocks.revealCurrentWindow.mockReset();
    handoffMocks.markDevDesktopHandoffOpened.mockResolvedValue(undefined);
    handoffMocks.takeDevDesktopHandoff.mockResolvedValue(null);
    handoffMocks.isMainTauriWebviewAvailable.mockReturnValue(true);
    handoffMocks.revealCurrentWindow.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("does not consume handoffs outside the Tauri desktop runtime", async () => {
    handoffMocks.isMainTauriWebviewAvailable.mockReturnValue(false);

    renderHook(() => useDevDesktopHandoff(), { wrapper: TestRouter });

    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(handoffMocks.takeDevDesktopHandoff).not.toHaveBeenCalled();
  });

  it("navigates and reveals Desktop after consuming a valid handoff", async () => {
    handoffMocks.takeDevDesktopHandoff.mockResolvedValueOnce({
      id: "handoff-1",
      url: "proliferate-local://join/org-1",
      createdAt: "2026-06-25T00:00:00.000Z",
    });

    const { result } = renderHook(() => useHandoffLocation(), {
      wrapper: TestRouter,
    });

    await waitFor(() => {
      expect(result.current).toBe(
        "/settings?section=organization-members&joinOrganizationId=org-1",
      );
    });
    expect(handoffMocks.revealCurrentWindow).toHaveBeenCalledTimes(1);
    expect(handoffMocks.markDevDesktopHandoffOpened).toHaveBeenCalledWith("handoff-1");
  });

  it("ignores replayed handoff ids after navigating once", async () => {
    handoffMocks.takeDevDesktopHandoff.mockResolvedValue({
      id: "handoff-replayed",
      url: "proliferate-local://join/org-1",
      createdAt: "2026-06-25T00:00:00.000Z",
    });

    const { result } = renderHook(() => useHandoffLocation(), {
      wrapper: TestRouter,
    });

    await waitFor(() => {
      expect(result.current).toBe(
        "/settings?section=organization-members&joinOrganizationId=org-1",
      );
    });
    expect(handoffMocks.revealCurrentWindow).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => window.setTimeout(resolve, 1100));

    await waitFor(() => {
      expect(handoffMocks.takeDevDesktopHandoff.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(handoffMocks.revealCurrentWindow).toHaveBeenCalledTimes(1);
    expect(handoffMocks.markDevDesktopHandoffOpened).toHaveBeenCalledTimes(1);
  });
});

function useHandoffLocation(): string {
  useDevDesktopHandoff();
  const location = useLocation();
  return `${location.pathname}${location.search}`;
}

function TestRouter({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/"]}>
      {children}
    </MemoryRouter>
  );
}
