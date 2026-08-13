// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

    const readVar = () =>
      document.documentElement.style.getPropertyValue("--proliferate-device-px");
    expect(readVar()).toBe("0.5px");

    vi.stubGlobal("devicePixelRatio", 0.8);
    act(() => media.fire());
    expect(readVar()).toBe("1.25px");
  });

  it("removes the variable and stops listening on unmount", () => {
    const media = stubMatchMedia();
    vi.stubGlobal("devicePixelRatio", 2);
    const { unmount } = renderHook(() => useDesktopDevicePixelLifecycle());
    unmount();

    expect(
      document.documentElement.style.getPropertyValue("--proliferate-device-px"),
    ).toBe("");

    vi.stubGlobal("devicePixelRatio", 1);
    act(() => media.fire());
    expect(
      document.documentElement.style.getPropertyValue("--proliferate-device-px"),
    ).toBe("");
  });
});
