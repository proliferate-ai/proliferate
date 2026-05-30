/**
 * Auth-only brand transition frames for ProliferateLivingMark.
 */
export const BRAILLE_SWEEP_DOT_FRAMES = [
  [0],
  [0, 1, 4],
  [0, 1, 2, 4, 5, 8],
  [0, 1, 2, 3, 4, 5, 6, 8, 9, 12],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13],
  [0, 1, 2, 3, 4, 5, 6, 8, 9, 12],
  [0, 1, 2, 4, 5, 8],
  [0, 1, 4],
  [0],
] as const;

export const BRAILLE_SWEEP_FRAME_INTERVAL_MS = 60;
