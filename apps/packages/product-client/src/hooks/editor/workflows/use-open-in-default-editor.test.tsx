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
      opened = await result.current.openInDefaultEditor("/tmp/outside.txt:12:3");
    });

    expect(opened).toBe(true);
    expect(listOpenTargets).toHaveBeenCalledTimes(2);
    expect(openTarget).toHaveBeenCalledWith("cursor", "/tmp/outside.txt");
    expect(result.current.ready).toBe(true);
  });
});
