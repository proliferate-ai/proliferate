import { afterEach, describe, expect, it } from "vitest";
import {
  clearMeasuredRowHeightsForTests,
  getMeasuredRowHeight,
  recordMeasuredRowHeight,
} from "#product/hooks/chat/ui/transcript-row-height-cache";

afterEach(clearMeasuredRowHeightsForTests);

const SESSION_A = "workspace-1:session-a";
const SESSION_B = "workspace-1:session-b";

describe("transcript row height cache", () => {
  it("returns null for a row key that was never measured", () => {
    expect(getMeasuredRowHeight(SESSION_A, "turn:1:block:content", "token-1")).toBeNull();
  });

  it("returns a measured height for the same session, row key, and composition token", () => {
    recordMeasuredRowHeight(SESSION_A, "turn:1:block:content", 812, "token-1");

    expect(getMeasuredRowHeight(SESSION_A, "turn:1:block:content", "token-1")).toBe(812);
  });

  it("is scoped to the session identity — a remount under a DIFFERENT session never sees it", () => {
    recordMeasuredRowHeight(SESSION_A, "turn:1:block:content", 812, "token-1");

    expect(getMeasuredRowHeight(SESSION_B, "turn:1:block:content", "token-1")).toBeNull();
  });

  it("invalidates the entry when the composition token changes (content changed shape)", () => {
    recordMeasuredRowHeight(SESSION_A, "turn:1:block:content", 812, "token-1");

    expect(getMeasuredRowHeight(SESSION_A, "turn:1:block:content", "token-2")).toBeNull();
    // The stale entry is dropped, not just masked — a later lookup under the
    // ORIGINAL token also misses, since the row is gone.
    expect(getMeasuredRowHeight(SESSION_A, "turn:1:block:content", "token-1")).toBeNull();
  });

  it("ignores non-finite or non-positive measured heights", () => {
    recordMeasuredRowHeight(SESSION_A, "turn:1:block:content", 0, "token-1");
    recordMeasuredRowHeight(SESSION_A, "turn:2:block:content", Number.NaN, "token-1");
    recordMeasuredRowHeight(SESSION_A, "turn:3:block:content", -40, "token-1");

    expect(getMeasuredRowHeight(SESSION_A, "turn:1:block:content", "token-1")).toBeNull();
    expect(getMeasuredRowHeight(SESSION_A, "turn:2:block:content", "token-1")).toBeNull();
    expect(getMeasuredRowHeight(SESSION_A, "turn:3:block:content", "token-1")).toBeNull();
  });

  it("refreshes recency on write so re-measuring an existing row doesn't evict it early", () => {
    recordMeasuredRowHeight(SESSION_A, "row-0", 100, "t");
    for (let i = 1; i < 500; i += 1) {
      recordMeasuredRowHeight(SESSION_A, `row-${i}`, 100 + i, "t");
    }
    // Touch row-0 again so it's the most-recently-written entry.
    recordMeasuredRowHeight(SESSION_A, "row-0", 150, "t");
    // Push one more new row past the 500 cap — the LEAST recently touched
    // entry (row-1, since row-0 was just refreshed) should be evicted, not
    // row-0.
    recordMeasuredRowHeight(SESSION_A, "row-500", 999, "t");

    expect(getMeasuredRowHeight(SESSION_A, "row-0", "t")).toBe(150);
    expect(getMeasuredRowHeight(SESSION_A, "row-1", "t")).toBeNull();
  });

  it("bounds a session's cache to 500 rows (LRU eviction of the oldest entry)", () => {
    for (let i = 0; i < 501; i += 1) {
      recordMeasuredRowHeight(SESSION_A, `row-${i}`, 100 + i, "t");
    }

    // The oldest (row-0) was evicted; the newest (row-500) is retained.
    expect(getMeasuredRowHeight(SESSION_A, "row-0", "t")).toBeNull();
    expect(getMeasuredRowHeight(SESSION_A, "row-500", "t")).toBe(600);
  });
});
