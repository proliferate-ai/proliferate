// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  usePromptAttachmentBlobText,
  usePromptAttachmentObjectUrlText,
} from "#product/hooks/access/prompt-attachments/use-prompt-attachment-text";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("prompt attachment text access", () => {
  it("reads an object URL and reports HTTP failures", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("preview text", { status: 200 }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(
      ({ objectUrl }: { objectUrl: string | null }) => (
        usePromptAttachmentObjectUrlText(objectUrl)
      ),
      { initialProps: { objectUrl: "blob:first" as string | null } },
    );

    await waitFor(() => expect(result.current.data).toBe("preview text"));
    rerender({ objectUrl: "blob:failure" });
    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("aborts replaced object-URL reads and never exposes stale text", async () => {
    const pending = new Map<string, {
      resolve: (response: Response) => void;
      signal: AbortSignal;
    }>();
    vi.stubGlobal("fetch", vi.fn((source: string, init?: RequestInit) => (
      new Promise<Response>((resolve) => {
        pending.set(source, { resolve, signal: init?.signal as AbortSignal });
      })
    )));
    const { result, rerender, unmount } = renderHook(
      ({ objectUrl }: { objectUrl: string | null }) => (
        usePromptAttachmentObjectUrlText(objectUrl)
      ),
      { initialProps: { objectUrl: "blob:old-secret" as string | null } },
    );

    await waitFor(() => expect(pending.has("blob:old-secret")).toBe(true));
    rerender({ objectUrl: "blob:replacement" });
    expect(result.current.data).toBeNull();
    expect(pending.get("blob:old-secret")?.signal.aborted).toBe(true);
    await waitFor(() => expect(pending.has("blob:replacement")).toBe(true));

    await act(async () => {
      pending.get("blob:replacement")!.resolve(new Response("replacement text"));
    });
    await waitFor(() => expect(result.current.data).toBe("replacement text"));
    await act(async () => {
      pending.get("blob:old-secret")!.resolve(new Response("old secret"));
    });
    expect(result.current.data).toBe("replacement text");

    unmount();
    expect(pending.get("blob:replacement")?.signal.aborted).toBe(true);
  });

  it("cancels blob reads and clears resolved identity synchronously", async () => {
    const oldRead = deferred<string>();
    const replacementRead = deferred<string>();
    const oldBlob = { text: vi.fn(() => oldRead.promise) } as unknown as Blob;
    const replacementBlob = {
      text: vi.fn(() => replacementRead.promise),
    } as unknown as Blob;
    const { result, rerender } = renderHook(
      ({ blob }: { blob: Blob | null }) => usePromptAttachmentBlobText(blob),
      { initialProps: { blob: oldBlob as Blob | null } },
    );

    rerender({ blob: replacementBlob });
    expect(result.current.data).toBeNull();
    await act(async () => replacementRead.resolve("replacement blob"));
    await waitFor(() => expect(result.current.data).toBe("replacement blob"));
    await act(async () => oldRead.resolve("old blob secret"));
    expect(result.current.data).toBe("replacement blob");

    rerender({ blob: null });
    expect(result.current).toEqual({
      data: null,
      isLoading: false,
      isError: false,
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
