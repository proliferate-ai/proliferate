import { describe, expect, it } from "vitest";
import {
  assignDistinctIdenticonSeeds,
  delegatedAgentIdenticonCells,
  identiconKey,
} from "@/lib/domain/delegated-work/identicon";
import {
  identiconSeedFromSalt,
  stableIndex,
} from "@/lib/domain/delegated-work/identity";

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

describe("assignDistinctIdenticonSeeds", () => {
  it("keeps salt 0 for everyone when no shapes collide", () => {
    const seeds = ["link-a", "link-b", "link-c", "link-d"];
    const shapeKeys = seeds.map((seed) => naturalShapeKey(seed));
    // Fixed seeds chosen for the test must not collide naturally, or the
    // assertion below would be about probing, not about the no-op path.
    expect(new Set(shapeKeys).size).toBe(seeds.length);

    const salts = assignDistinctIdenticonSeeds(seeds);

    expect([...salts.values()]).toEqual([0, 0, 0, 0]);
  });

  it("probes only the later sibling of an exact shape collision", () => {
    const [first, second] = findNaturallyCollidingSeeds();
    const salts = assignDistinctIdenticonSeeds([first, second]);

    expect(salts.get(first)).toBe(0);
    expect(salts.get(second)).toBeGreaterThan(0);
    expect(saltedShapeKey(first, salts.get(first) ?? 0))
      .not.toBe(saltedShapeKey(second, salts.get(second) ?? 0));
  });

  it("yields pairwise-distinct shapes for many siblings", () => {
    const seeds = Array.from({ length: 120 }, (_, index) => `sibling-${index}`);
    const salts = assignDistinctIdenticonSeeds(seeds);
    const shapeKeys = seeds.map((seed) => saltedShapeKey(seed, salts.get(seed) ?? 0));

    expect(new Set(shapeKeys).size).toBe(seeds.length);
  });

  it("reuses the entry for a duplicated seed instead of probing it away", () => {
    const salts = assignDistinctIdenticonSeeds(["link-a", "link-a"]);

    expect(salts.size).toBe(1);
    expect(salts.get("link-a")).toBe(0);
  });

  it("is deterministic for the same ordered seeds", () => {
    const seeds = Array.from({ length: 30 }, (_, index) => `det-${index}`);

    expect(assignDistinctIdenticonSeeds(seeds)).toEqual(assignDistinctIdenticonSeeds(seeds));
  });
});

function naturalShapeKey(seed: string): string {
  return saltedShapeKey(seed, 0);
}

function saltedShapeKey(seed: string, salt: number): string {
  return identiconKey(
    delegatedAgentIdenticonCells(identiconSeedFromSalt(stableIndex(seed), salt)),
  );
}

// Deterministic birthday search: with 2^15 shapes a natural collision shows
// up after a few hundred seeds, so the cap is generous, not hopeful.
function findNaturallyCollidingSeeds(): [string, string] {
  const seedByKey = new Map<string, string>();
  for (let index = 0; index < 20000; index += 1) {
    const seed = `collision-probe-${index}`;
    const key = naturalShapeKey(seed);
    const previous = seedByKey.get(key);
    if (previous) {
      return [previous, seed];
    }
    seedByKey.set(key, seed);
  }
  throw new Error("no natural identicon collision found within 20000 seeds");
}
