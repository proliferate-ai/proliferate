// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USER_PREFERENCE_DEFAULTS } from "@/lib/domain/preferences/user/model";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

const accessMocks = vi.hoisted(() => ({
  updater: {
    updatesSupported: true,
    availableVersion: "0.3.25" as string | null,
    availableTitle: "Introducing Grok" as string | null,
  },
  appVersion: { data: "0.3.24" as string | undefined },
  installedManifest: {
    status: "success" as "pending" | "error" | "success",
    data: {
      version: "0.3.24",
      title: "Faster workspaces",
    } as { version: string; title: string | null } | undefined,
  },
  openExternal: vi.fn(async () => undefined),
  requestedManifestVersion: null as string | null,
}));

vi.mock("@/hooks/access/tauri/use-updater", () => ({
  useUpdater: () => accessMocks.updater,
}));
vi.mock("@/hooks/access/tauri/app/use-app-version", () => ({
  useAppVersion: () => accessMocks.appVersion,
}));
vi.mock("@/hooks/access/downloads/desktop-releases/use-desktop-release-manifest", () => ({
  useDesktopReleaseManifest: (version: string | null) => {
    accessMocks.requestedManifestVersion = version;
    return accessMocks.installedManifest;
  },
}));
vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({ links: { openExternal: accessMocks.openExternal } }),
}));

import { useReleaseNotice } from "./use-release-notice";

describe("useReleaseNotice", () => {
  beforeEach(() => {
    accessMocks.updater.updatesSupported = true;
    accessMocks.updater.availableVersion = "0.3.25";
    accessMocks.updater.availableTitle = "Introducing Grok";
    accessMocks.appVersion.data = "0.3.24";
    accessMocks.installedManifest.status = "success";
    accessMocks.installedManifest.data = {
      version: "0.3.24",
      title: "Faster workspaces",
    };
    accessMocks.openExternal.mockResolvedValue(undefined);
    useUserPreferencesStore.setState({
      ...USER_PREFERENCE_DEFAULTS,
      _hydrated: true,
      _persistedMetadata: {},
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("ignores a titled available update and shows only the installed release", () => {
    const { result } = renderHook(() => useReleaseNotice());

    expect(result.current.notice).toEqual({
      version: "0.3.24",
      title: "Faster workspaces",
    });
    expect(result.current.notice?.title).not.toBe("Introducing Grok");
  });

  it("never resurrects an acknowledged installed release as available targets change", () => {
    useUserPreferencesStore.getState().set(
      "acknowledgedReleaseVersion",
      "0.3.24",
    );
    const { result, rerender } = renderHook(() => useReleaseNotice());
    expect(result.current.notice).toBeNull();

    accessMocks.updater.availableVersion = "0.3.26";
    accessMocks.updater.availableTitle = "Another release";
    rerender();
    expect(result.current.notice).toBeNull();

    accessMocks.updater.availableVersion = "0.3.27";
    accessMocks.updater.availableTitle = "Newest release";
    rerender();
    expect(result.current.notice).toBeNull();
    expect(useUserPreferencesStore.getState().acknowledgedReleaseVersion)
      .toBe("0.3.24");
  });

  it("shows a titled release only after that version is running", () => {
    accessMocks.appVersion.data = "0.3.25";
    accessMocks.installedManifest.data = {
      version: "0.3.25",
      title: "Introducing Grok",
    };

    const { result } = renderHook(() => useReleaseNotice());

    expect(result.current.notice).toEqual({
      version: "0.3.25",
      title: "Introducing Grok",
    });
  });

  it("acknowledges an installed notice when it is dismissed", () => {
    const { result } = renderHook(() => useReleaseNotice());

    act(() => result.current.dismissNotice());

    expect(useUserPreferencesStore.getState().acknowledgedReleaseVersion)
      .toBe("0.3.24");
    expect(result.current.notice).toBeNull();
  });

  it("opens the fixed changelog and then acknowledges the installed version", async () => {
    const { result } = renderHook(() => useReleaseNotice());

    act(() => result.current.openChangelog());

    expect(accessMocks.openExternal).toHaveBeenCalledWith(
      "https://proliferate.com/changelog",
    );
    await waitFor(() => {
      expect(useUserPreferencesStore.getState().acknowledgedReleaseVersion)
        .toBe("0.3.24");
    });
    expect(result.current.notice).toBeNull();
  });

  it("keeps the notice eligible when the changelog cannot be opened", async () => {
    accessMocks.openExternal.mockRejectedValueOnce(new Error("shell unavailable"));
    const { result } = renderHook(() => useReleaseNotice());

    act(() => result.current.openChangelog());

    await waitFor(() => expect(accessMocks.openExternal).toHaveBeenCalledTimes(1));
    expect(useUserPreferencesStore.getState().acknowledgedReleaseVersion).toBeNull();
    expect(result.current.notice?.version).toBe("0.3.24");
  });

  it("uses a matching cached installed title when the CDN is unavailable", () => {
    accessMocks.installedManifest.status = "error";
    accessMocks.installedManifest.data = undefined;
    useUserPreferencesStore.getState().set("cachedInstalledRelease", {
      version: "0.3.24",
      title: "Cached release",
    });

    const { result } = renderHook(() => useReleaseNotice());

    expect(result.current.notice).toEqual({
      version: "0.3.24",
      title: "Cached release",
    });
  });

  it("drops an old-version cache after the installed version changes", async () => {
    accessMocks.appVersion.data = "0.3.25";
    accessMocks.installedManifest.status = "error";
    accessMocks.installedManifest.data = undefined;
    useUserPreferencesStore.getState().set("cachedInstalledRelease", {
      version: "0.3.24",
      title: "Old release",
    });

    const { result } = renderHook(() => useReleaseNotice());

    expect(result.current.notice).toBeNull();
    await waitFor(() => {
      expect(useUserPreferencesStore.getState().cachedInstalledRelease).toBeNull();
    });
  });

  it("caches the current valid installed title as the bounded offline fallback", async () => {
    renderHook(() => useReleaseNotice());

    await waitFor(() => {
      expect(useUserPreferencesStore.getState().cachedInstalledRelease).toEqual({
        version: "0.3.24",
        title: "Faster workspaces",
      });
    });
  });

  it("clears a stale cache after a successful no-title response", async () => {
    accessMocks.installedManifest.data = { version: "0.3.24", title: null };
    useUserPreferencesStore.getState().set("cachedInstalledRelease", {
      version: "0.3.24",
      title: "Stale release",
    });

    const { result } = renderHook(() => useReleaseNotice());

    expect(result.current.notice).toBeNull();
    await waitFor(() => {
      expect(useUserPreferencesStore.getState().cachedInstalledRelease).toBeNull();
    });
  });

  it("waits for preference hydration before showing a notice", () => {
    useUserPreferencesStore.setState({ _hydrated: false });

    const { result } = renderHook(() => useReleaseNotice());

    expect(result.current.notice).toBeNull();
  });

  it("does not request or show an installed manifest when updates are unsupported", () => {
    accessMocks.updater.updatesSupported = false;

    const { result } = renderHook(() => useReleaseNotice());

    expect(accessMocks.requestedManifestVersion).toBeNull();
    expect(result.current.notice).toBeNull();
  });
});
