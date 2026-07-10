import { describe, expect, it } from "vitest";
import { compareSemver, isDesktopVersionSupported } from "./version-compat";

describe("compareSemver", () => {
  it("orders by major, minor, then patch", () => {
    expect(compareSemver("1.0.0", "2.0.0")).toBe(-1);
    expect(compareSemver("1.2.0", "1.1.9")).toBe(1);
    expect(compareSemver("1.1.1", "1.1.2")).toBe(-1);
    expect(compareSemver("3.4.5", "3.4.5")).toBe(0);
  });

  it("ignores pre-release and build suffixes", () => {
    expect(compareSemver("0.3.2-dev", "0.3.2")).toBe(0);
    expect(compareSemver("1.0.0+build.7", "1.0.0")).toBe(0);
  });

  it("returns null for unparseable versions", () => {
    expect(compareSemver("nightly", "1.0.0")).toBeNull();
    expect(compareSemver("1.0.0", "")).toBeNull();
  });
});

describe("isDesktopVersionSupported", () => {
  it("is supported when the desktop meets or exceeds the floor", () => {
    expect(isDesktopVersionSupported("0.3.2", "0.3.2")).toBe(true);
    expect(isDesktopVersionSupported("0.4.0", "0.3.2")).toBe(true);
  });

  it("is unsupported when the desktop is confidently older than the floor", () => {
    expect(isDesktopVersionSupported("0.3.1", "0.3.2")).toBe(false);
    expect(isDesktopVersionSupported("0.2.9", "1.0.0")).toBe(false);
  });

  it("fails open on unparseable versions (dev builds, empty pins)", () => {
    expect(isDesktopVersionSupported("0.0.0-dev", "0.3.2")).toBe(true);
    expect(isDesktopVersionSupported("0.3.2", "")).toBe(true);
  });
});
