// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { USER_PREFERENCE_DEFAULTS } from "#product/lib/domain/preferences/user/model";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

import { useDesktopDevicePixelLifecycle } from "#product/hooks/app/lifecycle/use-desktop-device-pixel-lifecycle";

function stubMatchMedia() {
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: (_: "change", cb: () => void) => listeners.add(cb),
    removeEventListener: (_: "change", cb: () => void) => listeners.delete(cb),
  }));
  return { fire: () => [...listeners].forEach((cb) => cb()) };
}

const readVar = () =>
  document.documentElement.style.getPropertyValue("--proliferate-device-px");

beforeEach(() => {
  useUserPreferencesStore.setState({
    ...USER_PREFERENCE_DEFAULTS,
    _hydrated: false,
    _persistedMetadata: {},
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--proliferate-device-px");
});

describe("useDesktopDevicePixelLifecycle", () => {
  it("publishes one device pixel in CSS units and tracks ratio changes", () => {
    const media = stubMatchMedia();
    vi.stubGlobal("devicePixelRatio", 2);
    renderHook(() => useDesktopDevicePixelLifecycle());

    expect(readVar()).toBe("0.5px");

    vi.stubGlobal("devicePixelRatio", 0.8);
    act(() => media.fire());
    expect(readVar()).toBe("1.25px");
  });

  it("re-publishes after the window-zoom preference changes, once native zoom settles", async () => {
    stubMatchMedia();
    vi.stubGlobal("devicePixelRatio", 2);
    renderHook(() => useDesktopDevicePixelLifecycle());
    expect(readVar()).toBe("0.5px");

    // The webview ratio only moves after the native zoom call lands; the
    // preference change alone must still trigger a delayed re-read.
    vi.stubGlobal("devicePixelRatio", 1.6);
    act(() => {
      useUserPreferencesStore.getState().set("windowZoomId", "zoom80");
    });

    await waitFor(() => expect(readVar()).toBe("0.625px"));
  });

  it("removes the variable and stops listening on unmount", async () => {
    const media = stubMatchMedia();
    vi.stubGlobal("devicePixelRatio", 2);
    const { unmount } = renderHook(() => useDesktopDevicePixelLifecycle());
    unmount();

    expect(readVar()).toBe("");

    vi.stubGlobal("devicePixelRatio", 1);
    act(() => {
      media.fire();
      useUserPreferencesStore.getState().set("windowZoomId", "zoom90");
    });
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(readVar()).toBe("");
  });
});
