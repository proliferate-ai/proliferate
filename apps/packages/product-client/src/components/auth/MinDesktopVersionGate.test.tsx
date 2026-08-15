// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MinDesktopVersionGate } from "#product/components/auth/MinDesktopVersionGate";

const gateMocks = vi.hoisted(() => ({
  gate: null as { blocked: boolean; appVersion: string; minDesktopVersion: string } | null,
}));
const updaterMocks = vi.hoisted(() => ({ checkNow: vi.fn() }));

vi.mock("#product/hooks/access/cloud/server-capabilities/use-min-desktop-version-gate", () => ({
  useMinDesktopVersionGate: () => gateMocks.gate,
}));

vi.mock("#product/hooks/access/tauri/use-updater", () => ({
  useUpdater: () => updaterMocks,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  gateMocks.gate = null;
});

describe("MinDesktopVersionGate", () => {
  it("renders nothing while the gate is unresolved", () => {
    gateMocks.gate = null;
    const { container } = render(<MinDesktopVersionGate />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the gate resolves not-blocked", () => {
    gateMocks.gate = { blocked: false, appVersion: "0.4.0", minDesktopVersion: "0.3.0" };
    const { container } = render(<MinDesktopVersionGate />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the blocking screen with current and required versions when blocked", () => {
    gateMocks.gate = { blocked: true, appVersion: "0.2.0", minDesktopVersion: "0.4.0" };

    render(<MinDesktopVersionGate />);

    expect(screen.getByText("Update required to continue")).toBeTruthy();
    expect(screen.getByText(/0\.2\.0/)).toBeTruthy();
    expect(screen.getByText(/0\.4\.0/)).toBeTruthy();
  });

  it("triggers checkNow from the action button", () => {
    gateMocks.gate = { blocked: true, appVersion: "0.2.0", minDesktopVersion: "0.4.0" };

    render(<MinDesktopVersionGate />);
    fireEvent.click(screen.getByRole("button", { name: /Check for update/ }));

    expect(updaterMocks.checkNow).toHaveBeenCalledTimes(1);
  });
});
