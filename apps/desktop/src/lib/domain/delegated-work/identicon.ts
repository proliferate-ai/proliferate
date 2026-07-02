import {
  identiconSeedFromSalt,
  mixHash,
  stableIndex,
} from "@/lib/domain/delegated-work/identity";

// Identicon grids are 5x5 with left-right mirror symmetry: columns 0-2 are
// independent and columns 3-4 mirror columns 1 and 0. That leaves 15 free bits
// per grid (2^15 = 32768 shapes), so a handful of sibling subagents stay
// visually distinct by shape alone even when their colors collide.
export const IDENTICON_GRID_SIZE = 5;
const INDEPENDENT_COLUMNS = 3;
const CELL_COUNT = IDENTICON_GRID_SIZE * IDENTICON_GRID_SIZE;

// Fewer than 3 lit cells reads as a speck at 12-16px and a near-full grid
// (fewer than 3 unlit cells) reads as a solid square; both would erase the
// fingerprint. Density is otherwise left unclamped on purpose: the natural
// binomial spread from sparse to dense is part of the look and helps shapes
// read as different.
const MIN_LIT_CELLS = 3;
const MAX_LIT_CELLS = CELL_COUNT - MIN_LIT_CELLS;
const MAX_DERIVE_ATTEMPTS = 32;

export function delegatedAgentIdenticonCells(seedHash: number): boolean[][] {
  let cells = cellsFromBits(shapeBits(seedHash, 0));
  for (let attempt = 1; attempt < MAX_DERIVE_ATTEMPTS && isDegenerate(cells); attempt += 1) {
    cells = cellsFromBits(shapeBits(seedHash, attempt));
  }
  return cells;
}

// Canonical key of a grid (rows flattened to "0"/"1") so shapes can be
// compared and deduped without comparing nested arrays.
export function identiconKey(cells: boolean[][]): string {
  return cells.flat().map((cell) => (cell ? "1" : "0")).join("");
}

// With 2^15 shapes and a handful of siblings, probing resolves in one step;
// the cap only bounds adversarial inputs.
const MAX_SHAPE_PROBES = 64;

// Sibling-aware shape guard, hash-preferred: every sibling keeps its natural
// fingerprint (salt 0) unless an EARLIER sibling already drew the exact same
// grid; only then the salt probes upward until the shape is unique. Unlike
// the color's pure position index, this must not renumber everyone — a
// position-based shape would turn the fingerprint into a seat number and
// break cross-surface consistency. `orderedSeeds` must come in the same
// stable order (created_at ASC, id ASC) the color pass uses.
export function assignDistinctIdenticonSeeds(
  orderedSeeds: readonly string[],
): Map<string, number> {
  const usedKeys = new Set<string>();
  const out = new Map<string, number>();
  for (const seed of orderedSeeds) {
    // A repeated seed is the same agent listed twice: reuse its salt instead
    // of probing it away from itself.
    if (out.has(seed)) continue;
    const seedHash = stableIndex(seed);
    let salt = 0;
    let key = shapeKeyForSalt(seedHash, salt);
    while (usedKeys.has(key) && salt < MAX_SHAPE_PROBES) {
      salt += 1;
      key = shapeKeyForSalt(seedHash, salt);
    }
    if (usedKeys.has(key)) {
      // 2^15 shapes against single-digit sibling lists makes exhaustion
      // effectively unreachable, but if it ever happens, say so instead of
      // silently registering a duplicate shape.
      console.warn("Delegated-agent identicon probing exhausted; a sibling shape may repeat.");
    }
    usedKeys.add(key);
    out.set(seed, salt);
  }
  return out;
}

function shapeKeyForSalt(seedHash: number, salt: number): string {
  return identiconKey(delegatedAgentIdenticonCells(identiconSeedFromSalt(seedHash, salt)));
}

// The shape must not reuse bits the name index (low bits of the raw seed hash)
// or the color index (low bits of a single mix) already consume, or same-color
// agents would share grid rows. Chaining the mix twice decorrelates all three.
function shapeBits(seedHash: number, attempt: number): number {
  return mixHash(mixHash((seedHash ^ attempt) >>> 0));
}

function cellsFromBits(bits: number): boolean[][] {
  const cells: boolean[][] = [];
  for (let row = 0; row < IDENTICON_GRID_SIZE; row += 1) {
    const rowCells: boolean[] = [];
    for (let column = 0; column < IDENTICON_GRID_SIZE; column += 1) {
      const independentColumn = Math.min(column, IDENTICON_GRID_SIZE - 1 - column);
      const bitIndex = row * INDEPENDENT_COLUMNS + independentColumn;
      rowCells.push((bits & (1 << bitIndex)) !== 0);
    }
    cells.push(rowCells);
  }
  return cells;
}

function isDegenerate(cells: boolean[][]): boolean {
  const litCount = cells.flat().filter(Boolean).length;
  return litCount < MIN_LIT_CELLS || litCount > MAX_LIT_CELLS;
}
