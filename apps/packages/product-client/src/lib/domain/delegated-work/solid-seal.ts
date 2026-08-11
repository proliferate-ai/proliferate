import { mixHash } from "#product/lib/domain/delegated-work/identity";

export type SolidSealShape =
  | "circle"
  | "squircle"
  | "diamond"
  | "rotated-square";

export interface SolidSealGeometry {
  shape: SolidSealShape;
  notchX: number;
  notchY: number;
}

const SOLID_SEAL_SHAPES: readonly SolidSealShape[] = [
  "circle",
  "squircle",
  "diamond",
  "rotated-square",
];

/**
 * Frozen UI-R01 Solid Seal geometry. The durable session hash chooses one
 * solid silhouette and one of eight notch positions. Render size never enters
 * this function, so every surface receives the same identity geometry.
 */
export function solidSealGeometry(sessionSeedHash: number): SolidSealGeometry {
  const hash = mixHash(sessionSeedHash);
  const angle = (((hash >>> 2) % 8) * 45 * Math.PI) / 180;
  return {
    shape: SOLID_SEAL_SHAPES[hash & 3] ?? "circle",
    notchX: round(12 + 4.1 * Math.cos(angle)),
    notchY: round(12 + 4.1 * Math.sin(angle)),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
