// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDesktopWindowThemeLifecycle } from "#product/hooks/preferences/lifecycle/use-desktop-window-theme-lifecycle";

beforeEach(() => {
  document.documentElement.dataset.mode = "dark";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useDesktopWindowThemeLifecycle", () => {
  it("applies the resolved theme on mount and when document mode changes", async () => {
    const setWindowTheme = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(() =>
      useDesktopWindowThemeLifecycle(setWindowTheme),
    );

    await waitFor(() => expect(setWindowTheme).toHaveBeenCalledWith("dark"));
    rerender();
    expect(setWindowTheme).toHaveBeenCalledTimes(1);

    act(() => {
      document.documentElement.dataset.mode = "light";
    });

    await waitFor(() => expect(setWindowTheme).toHaveBeenLastCalledWith("light"));
    expect(setWindowTheme).toHaveBeenCalledTimes(2);
  });

  it("keeps native theme failures non-fatal", async () => {
    const setWindowTheme = vi.fn().mockRejectedValue(new Error("native unavailable"));

    expect(() => {
      renderHook(() => useDesktopWindowThemeLifecycle(setWindowTheme));
    }).not.toThrow();

    await waitFor(() => expect(setWindowTheme).toHaveBeenCalledTimes(1));
  });

  it("stops exporting theme changes after unmount", async () => {
    const setWindowTheme = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() =>
      useDesktopWindowThemeLifecycle(setWindowTheme),
    );

    await waitFor(() => expect(setWindowTheme).toHaveBeenCalledTimes(1));
    unmount();

    act(() => {
      document.documentElement.dataset.mode = "light";
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(setWindowTheme).toHaveBeenCalledTimes(1);
  });
});
