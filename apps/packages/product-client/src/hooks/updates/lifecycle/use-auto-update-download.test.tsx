// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoUpdateDownload } from "#product/hooks/updates/lifecycle/use-auto-update-download";

const updaterMocks = vi.hoisted(() => ({
  phase: "available" as string,
  availableVersion: "0.4.1" as string | null,
  downloadUpdate: vi.fn(),
}));

const prefsMocks = vi.hoisted(() => ({
  autoUpdateEnabled: true,
  _hydrated: true,
}));

vi.mock("#product/hooks/access/tauri/use-updater", () => ({
  useUpdater: () => updaterMocks,
}));

vi.mock("#product/stores/preferences/user-preferences-store", () => ({
  useUserPreferencesStore: (select: (state: typeof prefsMocks) => unknown) =>
    select(prefsMocks),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  updaterMocks.phase = "available";
  updaterMocks.availableVersion = "0.4.1";
  prefsMocks.autoUpdateEnabled = true;
  prefsMocks._hydrated = true;
});

describe("useAutoUpdateDownload", () => {
  it("downloads without asking, which is what the copy already promised", () => {
    renderHook(() => useAutoUpdateDownload());

    expect(updaterMocks.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("starts once per version, not once per render", () => {
    const { rerender } = renderHook(() => useAutoUpdateDownload());
    rerender();
    rerender();

    expect(updaterMocks.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("leaves the click to the user when auto-update is off", () => {
    prefsMocks.autoUpdateEnabled = false;

    renderHook(() => useAutoUpdateDownload());

    // This is the only configuration in which the `available` announcement is
    // reached, which is what makes its "automatic updates are off" copy honest.
    expect(updaterMocks.downloadUpdate).not.toHaveBeenCalled();
  });

  it("waits for the preference to hydrate before acting on it", () => {
    prefsMocks._hydrated = false;

    renderHook(() => useAutoUpdateDownload());

    // Acting on the default before the stored value loads would download for a
    // user who had turned it off.
    expect(updaterMocks.downloadUpdate).not.toHaveBeenCalled();
  });

  it("does nothing outside the available phase", () => {
    for (const phase of ["idle", "checking", "downloading", "ready", "error"]) {
      updaterMocks.phase = phase;
      const { unmount } = renderHook(() => useAutoUpdateDownload());
      unmount();
    }

    expect(updaterMocks.downloadUpdate).not.toHaveBeenCalled();
  });
});
