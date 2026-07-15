import { describe, expect, it } from "vitest";
import {
  delegatedAgentIdenticonCells,
  identiconKey,
} from "@/lib/domain/delegated-work/identicon";
import { stableIndex } from "@/lib/domain/delegated-work/identity";

describe("delegatedAgentIdenticonCells", () => {
  it("is deterministic for a given seed hash", () => {
    const seedHash = stableIndex("link-abc123");

    expect(delegatedAgentIdenticonCells(seedHash)).toEqual(
      delegatedAgentIdenticonCells(seedHash),
    );
  });

  it("produces 5x5 grids with left-right mirror symmetry", () => {
    for (let index = 0; index < 50; index += 1) {
      const cells = delegatedAgentIdenticonCells(stableIndex(`mirror-seed-${index}`));

      expect(cells).toHaveLength(5);
      for (const row of cells) {
        expect(row).toHaveLength(5);
        expect(row[4]).toBe(row[0]);
        expect(row[3]).toBe(row[1]);
      }
    }
  });

  it("never yields a near-empty or near-full grid", () => {
    for (let index = 0; index < 500; index += 1) {
      const cells = delegatedAgentIdenticonCells(stableIndex(`density-seed-${index}`));
      const litCount = cells.flat().filter(Boolean).length;

      expect(litCount).toBeGreaterThanOrEqual(3);
      expect(litCount).toBeLessThanOrEqual(22);
    }
  });

  it("spreads distinct seeds across many distinct shapes", () => {
    const keys = new Set<string>();
    for (let index = 0; index < 300; index += 1) {
      keys.add(identiconKey(delegatedAgentIdenticonCells(stableIndex(`shape-seed-${index}`))));
    }

    expect(keys.size).toBeGreaterThanOrEqual(250);
  });
});

describe("identiconKey", () => {
  it("flattens the grid row by row into a 0/1 string", () => {
    const cells = [
      [true, false, false, false, true],
      [false, true, false, true, false],
      [false, false, true, false, false],
      [false, true, false, true, false],
      [true, false, false, false, true],
    ];

    expect(identiconKey(cells)).toBe("1000101010001000101010001");
  });
});
