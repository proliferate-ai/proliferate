import { describe, expect, it } from "vitest";
import { formatDownloadedMegabytesLine } from "#product/lib/domain/updates/byte-progress";

describe("formatDownloadedMegabytesLine", () => {
  it("formats the known-total form", () => {
    expect(formatDownloadedMegabytesLine(42_000_000, 100_000_000)).toBe(
      "42 of 100 MB downloaded",
    );
  });

  it("formats the unknown-total form unchanged (out of scope for D-R8)", () => {
    expect(formatDownloadedMegabytesLine(12_000_000, null)).toBe("12 MB downloaded");
    // Still susceptible to the sub-MB "0" rounding on the unknown-total
    // path, deliberately: the fix was scoped to the known-total form only.
    expect(formatDownloadedMegabytesLine(10_000, null)).toBe("0 MB downloaded");
  });

  // D-R8, bug 1: a sub-MB component with a sub-MB total used to render
  // "0 of 0 MB downloaded" for its entire download — a progress line that
  // reads as stalled at nothing while bytes are actively moving.
  it("never claims '0 of 0' while a sub-MB component is actively downloading", () => {
    const line = formatDownloadedMegabytesLine(10_000, 40_000);
    expect(line).not.toBe("0 of 0 MB downloaded");
    expect(line).toBe("<0.1 of <0.1 MB downloaded");
  });

  it("still reads as a bare 0 only when truly nothing has downloaded yet", () => {
    expect(formatDownloadedMegabytesLine(0, 40_000)).toBe("0 of <0.1 MB downloaded");
  });

  // D-R8, bug 2: downloaded must never exceed total — a since-corrected
  // advertised size must not let the line claim more was downloaded than
  // the total says exists.
  it("clamps downloaded to total rather than reporting an impossible overshoot", () => {
    expect(formatDownloadedMegabytesLine(60_000_000, 50_000_000)).toBe(
      "50 of 50 MB downloaded",
    );
  });

  it("does not clamp when downloaded is within total", () => {
    expect(formatDownloadedMegabytesLine(30_000_000, 50_000_000)).toBe(
      "30 of 50 MB downloaded",
    );
  });
});
