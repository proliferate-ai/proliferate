// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenTarget } from "@proliferate/product-client/host/desktop-bridge";
import { useOpenInDefaultEditor } from "#product/hooks/editor/workflows/use-open-in-default-editor";

const mocks = vi.hoisted(() => ({
  files: null as null | {
    listOpenTargets: ReturnType<typeof vi.fn>;
    openTarget: ReturnType<typeof vi.fn>;
  },
  preferredTargetId: "",
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    clipboard: { writeText: vi.fn(async () => undefined) },
    desktop: mocks.files ? { files: mocks.files } : null,
  }),
}));

vi.mock("#product/stores/preferences/user-preferences-store", () => ({
  useUserPreferencesStore: (
    selector: (state: { defaultOpenInTargetId: string }) => unknown,
  ) => selector({ defaultOpenInTargetId: mocks.preferredTargetId }),
}));

afterEach(() => {
  mocks.files = null;
  mocks.preferredTargetId = "";
  vi.clearAllMocks();
});

describe("useOpenInDefaultEditor", () => {
  it("does not discover targets while the path kind is null", async () => {
    const listOpenTargets = vi.fn(async () => []);
    mocks.files = {
      listOpenTargets,
      openTarget: vi.fn(async () => undefined),
    };

    const { result } = renderHook(() => useOpenInDefaultEditor(null));

    expect(result.current.targets).toEqual([]);
    expect(result.current.defaultTarget).toBeNull();
    expect(result.current.ready).toBe(false);
    await act(async () => Promise.resolve());
    expect(listOpenTargets).not.toHaveBeenCalled();
  });

  it("discovers targets for each committed file and directory kind", async () => {
    const fileTarget: OpenTarget = {
      id: "file-editor",
      label: "File editor",
      kind: "editor",
      iconId: "cursor",
    };
    const directoryTarget: OpenTarget = {
      id: "finder",
      label: "Finder",
      kind: "finder",
      iconId: "finder",
    };
    const listOpenTargets = vi.fn(async (kind: "file" | "directory") => (
      kind === "file" ? [fileTarget] : [directoryTarget]
    ));
    mocks.files = {
      listOpenTargets,
      openTarget: vi.fn(async () => undefined),
    };

    const { result, rerender } = renderHook(
      ({ kind }: { kind: "file" | "directory" | null }) => useOpenInDefaultEditor(kind),
      { initialProps: { kind: null } },
    );
    expect(listOpenTargets).not.toHaveBeenCalled();

    rerender({ kind: "file" });
    await waitFor(() => expect(result.current.targets).toEqual([fileTarget]));
    expect(listOpenTargets).toHaveBeenLastCalledWith("file");

    rerender({ kind: "directory" });
    expect(result.current.ready).toBe(false);
    expect(result.current.targets).toEqual([]);
    await waitFor(() => expect(result.current.targets).toEqual([directoryTarget]));
    expect(listOpenTargets).toHaveBeenLastCalledWith("directory");
  });

  it("uses the imperative kind when render state has not committed", async () => {
    const target: OpenTarget = {
      id: "finder",
      label: "Finder",
      kind: "finder",
      iconId: "finder",
    };
    const listOpenTargets = vi.fn(async () => [target]);
    const openTarget = vi.fn(async () => undefined);
    mocks.files = { listOpenTargets, openTarget };

    const { result } = renderHook(() => useOpenInDefaultEditor(null));

    await act(async () => {
      await expect(
        result.current.openInDefaultEditor("/tmp/folder", "directory"),
      ).resolves.toBe(true);
    });

    expect(listOpenTargets).toHaveBeenCalledExactlyOnceWith("directory");
    expect(openTarget).toHaveBeenCalledWith("finder", "/tmp/folder");
    expect(result.current.targets).toEqual([]);
    expect(result.current.defaultTarget).toBeNull();
    expect(result.current.ready).toBe(false);
  });

  it("retries target discovery after a transient bridge failure", async () => {
    const target: OpenTarget = {
      id: "cursor",
      label: "Cursor",
      kind: "editor",
      iconId: "cursor",
    };
    let rejectInitialRequest: (reason?: unknown) => void = () => undefined;
    const initialRequest = new Promise<OpenTarget[]>((_, reject) => {
      rejectInitialRequest = reject;
    });
    const listOpenTargets = vi.fn()
      .mockImplementationOnce(() => initialRequest)
      .mockResolvedValueOnce([target]);
    const openTarget = vi.fn(async () => undefined);
    mocks.files = { listOpenTargets, openTarget };

    const { result } = renderHook(() => useOpenInDefaultEditor("file"));

    await waitFor(() => {
      expect(listOpenTargets).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      rejectInitialRequest(new Error("Desktop bridge temporarily unavailable"));
      await initialRequest.catch(() => undefined);
    });

    let opened = false;
    await act(async () => {
      opened = await result.current.openInDefaultEditor(
        "/tmp/outside.txt:12:3",
        "file",
      );
    });

    expect(opened).toBe(true);
    expect(listOpenTargets).toHaveBeenCalledTimes(2);
    expect(openTarget).toHaveBeenCalledWith("cursor", "/tmp/outside.txt");
    expect(result.current.ready).toBe(true);
  });
});
