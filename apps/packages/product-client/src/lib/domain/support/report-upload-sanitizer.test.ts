import { describe, expect, it } from "vitest";
import { sanitizeSupportLogText } from "#product/lib/domain/support/report-upload-sanitizer";

describe("support report upload sanitizer", () => {
  it("marks an oversized incomplete log tail without exposing its text", () => {
    const privateSentinel = "private-sentinel-without-newline";
    const oversizedSingleLine = `${"x".repeat(2 * 1024 * 1024)}${privateSentinel}`;

    const sanitized = sanitizeSupportLogText(oversizedSingleLine);

    expect(sanitized).toBe("[truncated log tail omitted]");
    expect(sanitized).not.toContain(privateSentinel);
    expect(sanitized).not.toContain("x");
  });
});
