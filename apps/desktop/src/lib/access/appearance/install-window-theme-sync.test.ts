// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { installDesktopWindowThemeSync } from "./install-window-theme-sync";

const mocks = vi.hoisted(() => ({
  getResolvedMode: vi.fn<() => "dark" | "light">(),
  onThemeChange: vi.fn(),
  setWindowTheme: vi.fn(),
}));

vi.mock("@proliferate/product-client/internal/config/theme", () => ({
  getResolvedMode: mocks.getResolvedMode,
  onThemeChange: mocks.onThemeChange,
}));

vi.mock("@/lib/access/tauri/window", () => ({
  setWindowTheme: mocks.setWindowTheme,
}));

beforeEach(() => {
  mocks.getResolvedMode.mockReset().mockReturnValue("dark");
  mocks.onThemeChange.mockReset();
  mocks.setWindowTheme.mockReset().mockResolvedValue(undefined);
});

describe("installDesktopWindowThemeSync", () => {
  it("applies the initial theme and subsequent product theme changes", () => {
    let listener: (() => void) | undefined;
    mocks.onThemeChange.mockImplementation((callback: () => void) => {
      listener = callback;
    });

    installDesktopWindowThemeSync();
    expect(mocks.setWindowTheme).toHaveBeenCalledExactlyOnceWith("dark");

    mocks.getResolvedMode.mockReturnValue("light");
    listener?.();
    expect(mocks.setWindowTheme).toHaveBeenLastCalledWith("light");
    expect(mocks.setWindowTheme).toHaveBeenCalledTimes(2);
  });

  it("keeps native appearance failures non-fatal", async () => {
    mocks.setWindowTheme.mockRejectedValue(new Error("native unavailable"));

    expect(() => installDesktopWindowThemeSync()).not.toThrow();
    await vi.waitFor(() => expect(mocks.setWindowTheme).toHaveBeenCalledTimes(1));
  });
});
