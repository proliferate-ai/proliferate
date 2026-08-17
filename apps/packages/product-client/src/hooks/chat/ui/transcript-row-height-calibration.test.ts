import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearRowHeightCalibrationForTests,
  getCalibratedBucketHeight,
  recordBucketMeasurement,
} from "#product/hooks/chat/ui/transcript-row-height-calibration";

// Per-session per-bucket running average (Chat Scroll rung 5, PRO-187).
describe("transcript row-height calibration", () => {
  beforeEach(() => {
    clearRowHeightCalibrationForTests();
  });
  afterEach(() => {
    clearRowHeightCalibrationForTests();
  });

  it("returns null until a bucket has any measurement", () => {
    expect(getCalibratedBucketHeight("w:s", "turn:plain:2-3")).toBeNull();
  });

  it("returns the running average of real measurements for a bucket", () => {
    recordBucketMeasurement("w:s", "turn:plain:2-3", 420);
    recordBucketMeasurement("w:s", "turn:plain:2-3", 440);
    // Rounded mean of the two samples.
    expect(getCalibratedBucketHeight("w:s", "turn:plain:2-3")).toBe(430);
  });

  it("scopes averages by session and by bucket", () => {
    recordBucketMeasurement("w:s1", "turn:plain:2-3", 430);
    recordBucketMeasurement("w:s2", "turn:plain:2-3", 120);
    recordBucketMeasurement("w:s1", "turn:plain:1", 90);
    expect(getCalibratedBucketHeight("w:s1", "turn:plain:2-3")).toBe(430);
    expect(getCalibratedBucketHeight("w:s2", "turn:plain:2-3")).toBe(120);
    expect(getCalibratedBucketHeight("w:s1", "turn:plain:1")).toBe(90);
  });

  it("ignores a null bucket key and non-positive measurements", () => {
    recordBucketMeasurement("w:s", null, 430);
    recordBucketMeasurement("w:s", "turn:plain:2-3", 0);
    recordBucketMeasurement("w:s", "turn:plain:2-3", -10);
    recordBucketMeasurement("w:s", "turn:plain:2-3", Number.NaN);
    expect(getCalibratedBucketHeight("w:s", "turn:plain:2-3")).toBeNull();
  });

  it("keeps tracking without unbounded accumulation past the sample cap", () => {
    // Fill well past the internal cap with one value, then feed a very different
    // value: the average must migrate toward the new value rather than staying
    // pinned by the ancient samples or overflowing.
    for (let i = 0; i < 200; i += 1) {
      recordBucketMeasurement("w:s", "turn:plain:2-3", 100);
    }
    expect(getCalibratedBucketHeight("w:s", "turn:plain:2-3")).toBe(100);
    for (let i = 0; i < 400; i += 1) {
      recordBucketMeasurement("w:s", "turn:plain:2-3", 500);
    }
    // The capped running mean migrates decisively toward the recent value
    // rather than staying pinned by the ancient 100px samples.
    expect(getCalibratedBucketHeight("w:s", "turn:plain:2-3")).toBeGreaterThan(450);
  });
});
