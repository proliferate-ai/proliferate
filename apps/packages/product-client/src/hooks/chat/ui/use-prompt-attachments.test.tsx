// @vitest-environment jsdom

import type { PromptCapabilities } from "@anyharness/sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePromptAttachments } from "#product/hooks/chat/ui/use-prompt-attachments";

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
      value: vi.fn((blob: Blob) => `blob:prompt-attachment:${blob.size}`),
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

  it("creates preview URLs for image, file, and pasted-text drafts", () => {
    const { result } = renderHook(() =>
      usePromptAttachments("session-1", promptCapabilities)
    );
    const image = new File(["image-bytes"], "image.png", { type: "image/png" });
    const textFile = new File(["const ok = true;"], "example.ts", { type: "text/plain" });
    const pastedText = Array.from({ length: 25 }, (_, index) => `line ${index}`).join("\n");

    act(() => {
      result.current.addFiles([image, textFile]);
      result.current.addTextPaste(pastedText);
    });

    expect(URL.createObjectURL).toHaveBeenCalledTimes(3);
    expect(result.current.attachments).toHaveLength(3);
    expect(result.current.attachments.every((attachment) => attachment.objectUrl)).toBe(true);
  });

  it("revokes owned preview URLs when an attachment is removed or the hook unmounts", () => {
    const { result, unmount } = renderHook(() =>
      usePromptAttachments("session-1", promptCapabilities)
    );
    const first = new File(["one"], "one.txt", { type: "text/plain" });
    const second = new File(["two-two"], "two.txt", { type: "text/plain" });
    act(() => {
      result.current.addFiles([first, second]);
    });
    const [firstAttachment, secondAttachment] = result.current.attachments;

    act(() => {
      result.current.removeAttachment(firstAttachment!.id);
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstAttachment!.objectUrl);

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(secondAttachment!.objectUrl);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("notifies the lifetime owner before remove and submit revocation", () => {
    const onBeforeReleaseAttachments = vi.fn();
    const { result } = renderHook(() =>
      usePromptAttachments("session-1", promptCapabilities, {
        onBeforeReleaseAttachments,
      })
    );
    act(() => {
      result.current.addFiles([
        new File(["one"], "one.txt", { type: "text/plain" }),
        new File(["two"], "two.txt", { type: "text/plain" }),
      ]);
    });
    const [first, second] = result.current.attachments;

    act(() => result.current.removeAttachment(first!.id));
    expect(onBeforeReleaseAttachments).toHaveBeenNthCalledWith(1, [first]);
    expect(onBeforeReleaseAttachments.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(URL.revokeObjectURL).mock.invocationCallOrder[0]!);

    act(() => result.current.clearSubmittedAttachments([
      { id: second!.id },
    ]));
    expect(onBeforeReleaseAttachments).toHaveBeenNthCalledWith(2, [second]);
    expect(onBeforeReleaseAttachments.mock.invocationCallOrder[1])
      .toBeLessThan(vi.mocked(URL.revokeObjectURL).mock.invocationCallOrder[1]!);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
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
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:prompt-attachment:11");
  });
});
