// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { USER_PREFERENCE_DEFAULTS } from "@/lib/domain/preferences/user/model";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

import { useDesktopZoomPreferenceLifecycle } from "./use-desktop-zoom-preference-lifecycle";

beforeEach(() => {
  useUserPreferencesStore.setState({
    ...USER_PREFERENCE_DEFAULTS,
    _hydrated: false,
    _persistedMetadata: {},
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useDesktopZoomPreferenceLifecycle", () => {
  it("applies the stored zoom on mount and when the preference changes", async () => {
    const setZoom = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(() => useDesktopZoomPreferenceLifecycle(setZoom));

    await waitFor(() => expect(setZoom).toHaveBeenCalledWith(1));
    rerender();
    expect(setZoom).toHaveBeenCalledTimes(1);

    act(() => {
      useUserPreferencesStore.getState().set("windowZoomId", "zoom90");
    });

    await waitFor(() => expect(setZoom).toHaveBeenLastCalledWith(0.9));
    expect(setZoom).toHaveBeenCalledTimes(2);
  });

  it("keeps native zoom failures non-fatal", async () => {
    const setZoom = vi.fn().mockRejectedValue(new Error("native unavailable"));

    expect(() => {
      renderHook(() => useDesktopZoomPreferenceLifecycle(setZoom));
    }).not.toThrow();

    await waitFor(() => expect(setZoom).toHaveBeenCalledTimes(1));
  });

  it("stops exporting zoom changes after the Desktop lifecycle unmounts", async () => {
    const setZoom = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useDesktopZoomPreferenceLifecycle(setZoom));

    await waitFor(() => expect(setZoom).toHaveBeenCalledTimes(1));
    unmount();

    act(() => {
      useUserPreferencesStore.getState().set("windowZoomId", "zoom90");
    });

    expect(setZoom).toHaveBeenCalledTimes(1);
  });
});
