// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { USER_PREFERENCE_DEFAULTS } from "@proliferate/product-client/internal/lib/domain/preferences/user/model";
import { useUserPreferencesStore } from "@proliferate/product-client/internal/stores/preferences/user-preferences-store";

import { installDesktopWindowThemeSync } from "./install-window-theme-sync";

const mocks = vi.hoisted(() => ({
  setWindowTheme: vi.fn(),
}));

vi.mock("@/lib/access/tauri/window", () => ({
  setWindowTheme: mocks.setWindowTheme,
}));

let uninstall: (() => void) | undefined;

beforeEach(() => {
  mocks.setWindowTheme.mockReset().mockResolvedValue(undefined);
  useUserPreferencesStore.setState({
    ...USER_PREFERENCE_DEFAULTS,
    _hydrated: false,
    _persistedMetadata: {},
  });
});

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  delete document.documentElement.dataset.mode;
});

describe("installDesktopWindowThemeSync", () => {
  it("waits for preferences to hydrate and delegates stored system mode to native", () => {
    uninstall = installDesktopWindowThemeSync();
    expect(mocks.setWindowTheme).not.toHaveBeenCalled();

    useUserPreferencesStore.getState().hydrate({
      preferences: { ...USER_PREFERENCE_DEFAULTS, colorMode: "system" },
      persistedMetadata: {},
    });

    expect(mocks.setWindowTheme).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("clears an explicit override when system mode resolves to the same color", () => {
    document.documentElement.dataset.mode = "dark";
    useUserPreferencesStore.setState({ _hydrated: true, colorMode: "dark" });
    uninstall = installDesktopWindowThemeSync();
    expect(mocks.setWindowTheme).toHaveBeenCalledExactlyOnceWith("dark");

    useUserPreferencesStore.getState().set("colorMode", "system");

    expect(document.documentElement.dataset.mode).toBe("dark");
    expect(mocks.setWindowTheme).toHaveBeenLastCalledWith(null);
    expect(mocks.setWindowTheme).toHaveBeenCalledTimes(2);
  });

  it("tracks explicit color mode changes after hydration", () => {
    useUserPreferencesStore.setState({ _hydrated: true, colorMode: "dark" });
    uninstall = installDesktopWindowThemeSync();

    useUserPreferencesStore.getState().set("colorMode", "light");

    expect(mocks.setWindowTheme).toHaveBeenNthCalledWith(1, "dark");
    expect(mocks.setWindowTheme).toHaveBeenNthCalledWith(2, "light");
  });

  it("leaves native appearance delegated while the system color changes", () => {
    useUserPreferencesStore.setState({ _hydrated: true, colorMode: "system" });
    uninstall = installDesktopWindowThemeSync();
    expect(mocks.setWindowTheme).toHaveBeenCalledExactlyOnceWith(null);

    document.documentElement.dataset.mode = "light";
    document.documentElement.dataset.mode = "dark";

    expect(mocks.setWindowTheme).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("keeps native appearance failures non-fatal", async () => {
    mocks.setWindowTheme.mockRejectedValue(new Error("native unavailable"));
    useUserPreferencesStore.setState({ _hydrated: true, colorMode: "light" });

    expect(() => {
      uninstall = installDesktopWindowThemeSync();
    }).not.toThrow();
    await vi.waitFor(() => expect(mocks.setWindowTheme).toHaveBeenCalledTimes(1));
  });
});
