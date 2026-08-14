import { describe, expect, it } from "vitest";
import { stableIndex } from "#product/lib/domain/delegated-work/identity";
import { solidSealGeometry } from "#product/lib/domain/delegated-work/solid-seal";

describe("solidSealGeometry", () => {
  it("is deterministic for a durable session ID", () => {
    const seedHash = stableIndex("session-67e55044-10b1-426f-9247-bb680e5fe0c8");

    expect(solidSealGeometry(seedHash)).toEqual(solidSealGeometry(seedHash));
  });

  it("matches the unrounded 1e reference coordinates for a diagonal notch", () => {
    const geometry = solidSealGeometry(stableIndex("session-diagonal-0"));

    // Independently evaluated from glyphs.js style 1e:
    // h=mix(hash(seed)), angle=((h>>>2)%8)*45°, coordinate=12+4.1*(cos,sin).
    expect(geometry.notchX).toBe(14.899137802864844);
    expect(geometry.notchY).toBe(9.100862197135154);
  });

  it("selects only the frozen silhouettes and eight notch positions", () => {
    const shapes = new Set<string>();
    const notchPositions = new Set<string>();

    for (let index = 0; index < 256; index += 1) {
      const geometry = solidSealGeometry(stableIndex(`session-${index}`));
      shapes.add(geometry.shape);
      notchPositions.add(`${geometry.notchX},${geometry.notchY}`);
    }

    expect(shapes).toEqual(new Set(["circle", "squircle", "diamond", "rotated-square"]));
    expect(notchPositions.size).toBe(8);
  });
});
