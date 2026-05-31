// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppearancePreferenceLifecycle } from "@/hooks/preferences/lifecycle/use-appearance-preference-lifecycle";
import { USER_PREFERENCE_DEFAULTS } from "@/lib/domain/preferences/user/model";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

interface MatchMediaStub {
  setMatches: (matches: boolean) => void;
}

function resetAppearanceState() {
  useUserPreferencesStore.setState({
    ...USER_PREFERENCE_DEFAULTS,
    _hydrated: false,
    _persistedMetadata: {},
  });
  const root = document.documentElement;
  delete root.dataset.theme;
  delete root.dataset.mode;
  delete root.dataset.uiFontSize;
  delete root.dataset.readableCodeFontSize;
  root.style.cssText = "";
}

function installMatchMediaStub(initialMatches: boolean): MatchMediaStub {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn((_type: "change", listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: "change", listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;

  vi.stubGlobal("matchMedia", vi.fn(() => query));

  return {
    setMatches: (nextMatches: boolean) => {
      matches = nextMatches;
      const event = { matches, media: query.media } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
}

describe("useAppearancePreferenceLifecycle", () => {
  beforeEach(() => {
    resetAppearanceState();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    resetAppearanceState();
  });

  it("applies default mono appearance tokens on mount", async () => {
    installMatchMediaStub(true);

    renderHook(() => useAppearancePreferenceLifecycle());

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("mono");
      expect(document.documentElement.dataset.mode).toBe("dark");
      expect(document.documentElement.dataset.uiFontSize).toBe("default");
      expect(document.documentElement.dataset.readableCodeFontSize).toBe("default");
      expect(document.documentElement.style.getPropertyValue("--text-chat")).toBe("12px");
    });
  });

  it("tracks store changes for theme and size tokens", async () => {
    installMatchMediaStub(true);

    renderHook(() => useAppearancePreferenceLifecycle());

    act(() => {
      useUserPreferencesStore.getState().setMultiple({
        themePreset: "tbpn",
        uiFontSizeId: "large",
        readableCodeFontSizeId: "xlarge",
      });
    });

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("tbpn");
      expect(document.documentElement.dataset.mode).toBe("dark");
      expect(document.documentElement.dataset.uiFontSize).toBe("large");
      expect(document.documentElement.dataset.readableCodeFontSize).toBe("xlarge");
      expect(document.documentElement.style.getPropertyValue("--text-chat")).toBe("13px");
      expect(document.documentElement.style.getPropertyValue("--readable-code-font-size")).toBe("0.8125rem");
    });
  });

  it("reapplies system color mode when the system preference changes", async () => {
    const matchMedia = installMatchMediaStub(false);

    renderHook(() => useAppearancePreferenceLifecycle());

    act(() => {
      useUserPreferencesStore.getState().set("colorMode", "system");
    });

    await waitFor(() => {
      expect(document.documentElement.dataset.mode).toBe("light");
    });

    act(() => {
      matchMedia.setMatches(true);
    });

    await waitFor(() => {
      expect(document.documentElement.dataset.mode).toBe("dark");
    });
  });
});
