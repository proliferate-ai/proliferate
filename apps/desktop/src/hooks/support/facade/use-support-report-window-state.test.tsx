/* @vitest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { DragEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSupportReportWindowState } from "@/hooks/support/facade/use-support-report-window-state";

const supportAccess = vi.hoisted(() => ({
  closeSupportReportWindow: vi.fn(async () => {}),
  deleteStagedSupportReportAttachment: vi.fn(async () => {}),
  getSupportReportWindowSnapshot: vi.fn(async (): Promise<unknown> => null),
  listenSupportSnapshotUpdates: vi.fn(async () => vi.fn()),
  stageSupportReportAttachment: vi.fn(async (input: { fileName: string }) => ({
    path: `/tmp/${input.fileName}`,
  })),
  submitSupportReportJob: vi.fn(async () => {}),
}));

vi.mock("@/lib/access/tauri/support", () => supportAccess);

beforeEach(() => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000000");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("useSupportReportWindowState attachments", () => {
  it("stages screenshot drops from item-backed transfers", async () => {
    const { result } = renderHook(() => useSupportReportWindowState());
    const file = new File(["image"], "", { type: "image/png" });
    const event = {
      dataTransfer: {
        files: emptyFileList(),
        items: dataTransferItems([
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => file,
          } as DataTransferItem,
        ]),
        types: ["Files"],
        dropEffect: "none",
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    act(() => {
      result.current.handleAttachmentDrop(event as unknown as DragEvent<HTMLElement>);
    });

    await waitFor(() => {
      expect(supportAccess.stageSupportReportAttachment).toHaveBeenCalledWith({
        clientFileId: "00000000-0000-4000-8000-000000000000",
        fileName: "screenshot.png",
        dataBase64: expect.any(String),
      });
      expect(result.current.attachments).toHaveLength(1);
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(result.current.attachments[0]?.fileName).toBe("screenshot.png");
  });

  it("submits only one job for repeated send clicks", async () => {
    supportAccess.getSupportReportWindowSnapshot.mockResolvedValueOnce({
      openedAt: "2026-05-31T12:00:00.000Z",
      source: "sidebar",
      context: {
        source: "sidebar",
        intent: "general",
      },
      defaultScope: "app_only",
      defaultWorkspaceId: null,
      workspaceOptions: [],
    });
    let resolveSubmit: (() => void) | null = null;
    supportAccess.submitSupportReportJob.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        resolveSubmit = resolve;
      });
    });

    const { result } = renderHook(() => useSupportReportWindowState());

    await waitFor(() => {
      expect(result.current.snapshot).not.toBeNull();
    });
    act(() => {
      result.current.setMessage("Help");
    });
    await waitFor(() => {
      expect(result.current.canSend).toBe(true);
    });

    act(() => {
      void result.current.handleSend();
      void result.current.handleSend();
    });

    expect(supportAccess.submitSupportReportJob).toHaveBeenCalledTimes(1);
    act(() => {
      resolveSubmit?.();
    });
    await waitFor(() => {
      expect(supportAccess.closeSupportReportWindow).toHaveBeenCalledTimes(1);
    });
  });
});

function emptyFileList(): FileList {
  return {
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* iterator() {},
  } as FileList;
}

function dataTransferItems(items: DataTransferItem[]): DataTransferItemList {
  const list = {
    length: items.length,
    item: (index: number) => items[index] ?? null,
    [Symbol.iterator]: function* iterator() {
      yield* items;
    },
  } as unknown as DataTransferItemList;
  items.forEach((item, index) => {
    (list as unknown as Record<number, DataTransferItem>)[index] = item;
  });
  return list;
}
