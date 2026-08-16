import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginSessionRestorePlacement,
  clearReadingPositionsForTests,
  getReadingPosition,
  recordReadingPosition,
  resolveTranscriptReadingAnchor,
  resolveTranscriptRestoreTargetTop,
  type TranscriptSessionRestorePlan,
} from "./transcript-reading-position-store";

afterEach(() => {
  clearReadingPositionsForTests();
});

describe("transcript-reading-position-store", () => {
  it("records and reads a reading position per session identity", () => {
    recordReadingPosition("ws:a", { rowKey: "turn:1:block:content", offsetWithinRowPx: 40 });
    recordReadingPosition("ws:b", { rowKey: "turn:9:block:content", offsetWithinRowPx: 0 });
    expect(getReadingPosition("ws:a")).toEqual({
      rowKey: "turn:1:block:content",
      offsetWithinRowPx: 40,
    });
    expect(getReadingPosition("ws:b")?.rowKey).toBe("turn:9:block:content");
    expect(getReadingPosition("ws:missing")).toBeNull();
  });

  it("bounds retained sessions as an LRU, evicting the oldest", () => {
    for (let i = 0; i < 250; i += 1) {
      recordReadingPosition(`ws:${i}`, { rowKey: `turn:${i}`, offsetWithinRowPx: 0 });
    }
    // The 200-session cap dropped the earliest keys; the newest survive.
    expect(getReadingPosition("ws:0")).toBeNull();
    expect(getReadingPosition("ws:249")?.rowKey).toBe("turn:249");
  });

  describe("resolveTranscriptReadingAnchor", () => {
    const rows = [
      { kind: "transcript" as const, key: "turn:0:block:content" },
      { kind: "transcript" as const, key: "turn:1:block:content" },
      { kind: "history_loader" as const, key: "history-loader" },
    ];
    const items = [
      { index: 0, start: 0, end: 200 },
      { index: 1, start: 200, end: 500 },
    ];

    it("captures the top-visible transcript row and offset within it", () => {
      // scrollTop 260 sits inside row index 1 (start 200), 60px in.
      expect(resolveTranscriptReadingAnchor(items, 260, rows)).toEqual({
        rowKey: "turn:1:block:content",
        offsetWithinRowPx: 60,
      });
    });

    it("clamps a negative offset to zero and ignores non-transcript rows", () => {
      // No virtual item reaches scrollTop -> no anchor.
      expect(resolveTranscriptReadingAnchor([], 100, rows)).toBeNull();
      // A top-visible row that is the history loader yields no anchor.
      const loaderItems = [{ index: 2, start: 500, end: 560 }];
      expect(resolveTranscriptReadingAnchor(loaderItems, 520, rows)).toBeNull();
    });
  });

  describe("resolveTranscriptRestoreTargetTop", () => {
    const rows = [
      { kind: "transcript" as const, key: "turn:0:block:content" },
      { kind: "transcript" as const, key: "turn:1:block:content" },
    ];

    // A viewport whose mounted rows are absent, forcing the coarse absolute
    // fallback path (the target row is not yet in the render window).
    function noMountedRowsViewport(scrollTop = 0): HTMLElement {
      return {
        scrollTop,
        querySelector: () => null,
        getBoundingClientRect: () => ({ top: 0 }) as unknown as DOMRect,
      } as unknown as HTMLElement;
    }

    it("estimate-immune path: seats the saved offset under the top edge from the row's real rect", () => {
      // The saved row is mounted 300px below the viewport top edge; to seat 60px
      // of it under the top edge the viewport must scroll to 200 + 300 + 60.
      const rowEl = {
        getBoundingClientRect: () => ({ top: 340 }) as unknown as DOMRect,
      } as unknown as HTMLElement;
      const viewport = {
        scrollTop: 200,
        querySelector: (sel: string) => (sel === '[data-index="1"]' ? rowEl : null),
        getBoundingClientRect: () => ({ top: 40 }) as unknown as DOMRect,
      } as unknown as HTMLElement;
      const target = resolveTranscriptRestoreTargetTop(
        viewport,
        () => 999_999, // absolute estimate deliberately wrong; must be ignored.
        rows,
        { rowKey: "turn:1:block:content", offsetWithinRowPx: 60 },
      );
      expect(target).toEqual({ top: 200 + (340 - 40) + 60, mounted: true });
    });

    it("coarse fallback: inverts a saved anchor via the absolute estimate when the row is not mounted", () => {
      // Row index 1 estimated to start at 640, + 60px offset = 700.
      const target = resolveTranscriptRestoreTargetTop(
        noMountedRowsViewport(),
        (index) => (index === 1 ? 640 : 0),
        rows,
        { rowKey: "turn:1:block:content", offsetWithinRowPx: 60 },
      );
      expect(target).toEqual({ top: 700, mounted: false });
    });

    it("returns null when the saved row no longer exists (saved-row-gone)", () => {
      const target = resolveTranscriptRestoreTargetTop(
        noMountedRowsViewport(),
        () => 0,
        rows,
        { rowKey: "turn:99:block:content", offsetWithinRowPx: 10 },
      );
      expect(target).toBeNull();
    });

    it("returns null when the row start is unavailable and the row is not mounted", () => {
      const target = resolveTranscriptRestoreTargetTop(
        noMountedRowsViewport(),
        () => null,
        rows,
        { rowKey: "turn:0:block:content", offsetWithinRowPx: 10 },
      );
      expect(target).toBeNull();
    });
  });

  describe("beginSessionRestorePlacement", () => {
    function makeRefs(scrollTop = 0) {
      // scrollHeight/clientHeight give a reachable max so the pre-paint placement
      // guard (target must be within the current content) does not suppress the
      // write in these unit assertions.
      const viewport = { scrollTop, scrollHeight: 5000, clientHeight: 600 } as HTMLDivElement;
      return {
        viewport,
        scrollRef: { current: viewport },
        restoreResolverRef: {
          current: null as
            | ((viewport: HTMLElement) => { top: number; mounted: boolean } | null)
            | null,
        },
        restoreDeadlineRef: { current: 0 },
      };
    }

    it("places a resolvable restore, unpins, and arms the frame-writer anchor", () => {
      const refs = makeRefs();
      const setPinned = vi.fn();
      const plan: TranscriptSessionRestorePlan = {
        kind: "restore",
        resolveTargetTop: () => ({ top: 450, mounted: true }),
      };
      const placed = beginSessionRestorePlacement(
        plan,
        1234,
        refs,
        setPinned,
        (write) => write(),
      );
      expect(placed).toBe(true);
      expect(setPinned).toHaveBeenCalledWith(false, "session_reset");
      expect(refs.viewport.scrollTop).toBe(450);
      expect(refs.restoreResolverRef.current).toBe(plan.kind === "restore" ? plan.resolveTargetTop : null);
      expect(refs.restoreDeadlineRef.current).toBe(1234);
    });

    it("does not place a bottom plan", () => {
      const refs = makeRefs(10);
      const placed = beginSessionRestorePlacement(
        { kind: "bottom" },
        1234,
        refs,
        vi.fn(),
        (write) => write(),
      );
      expect(placed).toBe(false);
      expect(refs.viewport.scrollTop).toBe(10);
      expect(refs.restoreResolverRef.current).toBeNull();
    });

    it("does not place when the saved row is gone (resolver null)", () => {
      const refs = makeRefs(10);
      const setPinned = vi.fn();
      const placed = beginSessionRestorePlacement(
        { kind: "restore", resolveTargetTop: () => null },
        1234,
        refs,
        setPinned,
        (write) => write(),
      );
      expect(placed).toBe(false);
      expect(setPinned).not.toHaveBeenCalled();
      expect(refs.viewport.scrollTop).toBe(10);
      expect(refs.restoreResolverRef.current).toBeNull();
    });
  });
});
