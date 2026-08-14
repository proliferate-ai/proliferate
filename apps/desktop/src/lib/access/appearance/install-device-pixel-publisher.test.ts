// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { USER_PREFERENCE_DEFAULTS } from "@proliferate/product-client/internal/lib/domain/preferences/user/model";
import { useUserPreferencesStore } from "@proliferate/product-client/internal/stores/preferences/user-preferences-store";

import { installDesktopDevicePixelPublisher } from "./install-device-pixel-publisher";

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

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--proliferate-device-px");
  useUserPreferencesStore.setState({
    ...USER_PREFERENCE_DEFAULTS,
    _hydrated: false,
    _persistedMetadata: {},
  });
});

describe("installDesktopDevicePixelPublisher", () => {
  it("publishes one device pixel in CSS units and tracks ratio changes", () => {
    const media = stubMatchMedia();
    vi.stubGlobal("devicePixelRatio", 2);
    installDesktopDevicePixelPublisher();

    expect(readVar()).toBe("0.5px");

    vi.stubGlobal("devicePixelRatio", 0.8);
    media.fire();
    expect(readVar()).toBe("1.25px");
  });

  it("re-publishes after the window-zoom preference changes, once native zoom settles", async () => {
    stubMatchMedia();
    vi.stubGlobal("devicePixelRatio", 2);
    installDesktopDevicePixelPublisher();
    expect(readVar()).toBe("0.5px");

    // The webview ratio only moves after the native zoom call lands; the
    // preference change alone must still trigger a delayed re-read.
    vi.stubGlobal("devicePixelRatio", 1.6);
    useUserPreferencesStore.getState().set("windowZoomId", "zoom80");

    await vi.waitFor(() => expect(readVar()).toBe("0.625px"));
  });
});
