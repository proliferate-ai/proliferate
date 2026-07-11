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

  it("keeps attachments across same-workspace harness capability changes", () => {
    const { result, rerender } = renderHook(
      ({ capabilities }: { capabilities: PromptCapabilities | null }) =>
        usePromptAttachments("workspace-1", capabilities),
      { initialProps: { capabilities: promptCapabilities as PromptCapabilities | null } },
    );
    const image = new File(["image-bytes"], "image.png", { type: "image/png" });
    act(() => {
      result.current.addFiles([image]);
    });

    rerender({ capabilities: null });
    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.hasAttachments).toBe(true);
    expect(result.current.hasSupportedAttachments).toBe(false);
    expect(result.current.snapshotForSubmit()).toEqual([]);

    act(() => {
      result.current.clearSubmittedAttachments(result.current.snapshotForSubmit());
    });
    expect(result.current.attachments).toHaveLength(1);

    rerender({ capabilities: promptCapabilities });
    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.hasAttachments).toBe(true);
    expect(result.current.hasSupportedAttachments).toBe(true);
    const submitted = result.current.snapshotForSubmit();
    expect(submitted).toHaveLength(1);

    act(() => {
      result.current.clearSubmittedAttachments(submitted);
    });
    expect(result.current.attachments).toEqual([]);
  });

  it("clears attachments when the selected workspace changes", () => {
    const { result, rerender } = renderHook(
      ({ scopeKey }) => usePromptAttachments(scopeKey, promptCapabilities),
      { initialProps: { scopeKey: "workspace-1" } },
    );
    const image = new File(["image-bytes"], "image.png", { type: "image/png" });
    act(() => {
      result.current.addFiles([image]);
    });

    rerender({ scopeKey: "workspace-2" });

    expect(result.current.attachments).toEqual([]);
    expect(result.current.snapshotForSubmit()).toEqual([]);
  });
});
