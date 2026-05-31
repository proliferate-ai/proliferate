/* @vitest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { DragEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSupportReportWindowState } from "@/hooks/support/facade/use-support-report-window-state";

const supportAccess = vi.hoisted(() => ({
  closeSupportReportWindow: vi.fn(async () => {}),
  deleteStagedSupportReportAttachment: vi.fn(async () => {}),
  getSupportReportWindowSnapshot: vi.fn(async () => null),
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
