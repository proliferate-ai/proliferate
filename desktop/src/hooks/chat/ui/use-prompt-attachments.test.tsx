// @vitest-environment jsdom

import type { PromptCapabilities } from "@anyharness/sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePromptAttachments } from "./use-prompt-attachments";

const promptCapabilities: PromptCapabilities = {
  image: true,
  audio: false,
  embeddedContext: true,
};

const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

describe("usePromptAttachments", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:prompt-attachment"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectUrl,
    });
  });

  it("includes a just-added image in the same-turn submit snapshot", () => {
    const { result } = renderHook(() =>
      usePromptAttachments("session-1", promptCapabilities)
    );
    const image = new File(["image-bytes"], "image.png", { type: "image/png" });

    let snapshots = result.current.snapshotForSubmit();
    act(() => {
      result.current.addFiles([image]);
      snapshots = result.current.snapshotForSubmit();
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      file: image,
      kind: "image",
      mimeType: "image/png",
      name: "image.png",
      size: image.size,
      source: "upload",
    });
  });

  it("clears the submit snapshot synchronously", () => {
    const { result } = renderHook(() =>
      usePromptAttachments("session-1", promptCapabilities)
    );
    const image = new File(["image-bytes"], "image.png", { type: "image/png" });

    act(() => {
      result.current.addFiles([image]);
      result.current.clearAttachments();
    });

    expect(result.current.snapshotForSubmit()).toEqual([]);
  });
});
