import { mixHash } from "@/lib/domain/delegated-work/identity";

// Identicon grids are 5x5 with left-right mirror symmetry: columns 0-2 are
// independent and columns 3-4 mirror columns 1 and 0. That leaves 15 free bits
// per grid (2^15 = 32768 shapes), so a handful of sibling subagents stay
// visually distinct by shape alone even when their colors collide.
const GRID_SIZE = 5;
const INDEPENDENT_COLUMNS = 3;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;

// Fewer than 3 lit cells reads as a speck at 12-16px and a full grid reads as
// a solid square; both would erase the fingerprint. Density is otherwise left
// unclamped on purpose: the natural binomial spread from sparse to dense is
// part of the look and helps shapes read as different.
const MIN_LIT_CELLS = 3;
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

// The shape must not reuse bits the name index (low bits of the raw seed hash)
// or the color index (low bits of a single mix) already consume, or same-color
// agents would share grid rows. Chaining the mix twice decorrelates all three.
function shapeBits(seedHash: number, attempt: number): number {
  return mixHash(mixHash((seedHash ^ attempt) >>> 0));
}

function cellsFromBits(bits: number): boolean[][] {
  const cells: boolean[][] = [];
  for (let row = 0; row < GRID_SIZE; row += 1) {
    const rowCells: boolean[] = [];
    for (let column = 0; column < GRID_SIZE; column += 1) {
      const independentColumn = Math.min(column, GRID_SIZE - 1 - column);
      const bitIndex = row * INDEPENDENT_COLUMNS + independentColumn;
      rowCells.push((bits & (1 << bitIndex)) !== 0);
    }
    cells.push(rowCells);
  }
  return cells;
}

function isDegenerate(cells: boolean[][]): boolean {
  const litCount = cells.flat().filter(Boolean).length;
  return litCount < MIN_LIT_CELLS || litCount === CELL_COUNT;
}
