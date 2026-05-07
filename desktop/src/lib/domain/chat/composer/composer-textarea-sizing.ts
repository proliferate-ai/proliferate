export type ComposerTextareaOverflowY = "auto" | "hidden";

export interface ComposerTextareaAutosizeInput {
  scrollHeightPx: number;
  lineHeightPx: number;
  rootFontSizePx: number;
  lineHeightRem: number;
  minRows: number;
  maxRows: number;
  minHeightRem: number;
}

export interface ComposerTextareaAutosizeResult {
  heightPx: number;
  overflowY: ComposerTextareaOverflowY;
}

const FALLBACK_ROOT_FONT_SIZE_PX = 16;

export function computeComposerTextareaAutosize({
  scrollHeightPx,
  lineHeightPx,
  rootFontSizePx,
  lineHeightRem,
  minRows,
  maxRows,
  minHeightRem,
}: ComposerTextareaAutosizeInput): ComposerTextareaAutosizeResult {
  const effectiveRootFontSizePx = isPositiveFinite(rootFontSizePx)
    ? rootFontSizePx
    : FALLBACK_ROOT_FONT_SIZE_PX;
  const effectiveLineHeightPx = isPositiveFinite(lineHeightPx)
    ? lineHeightPx
    : effectiveRootFontSizePx * lineHeightRem;
  const effectiveScrollHeightPx = isPositiveFinite(scrollHeightPx)
    ? scrollHeightPx
    : 0;
  const minHeightPx = Math.max(
    effectiveLineHeightPx * minRows,
    effectiveRootFontSizePx * minHeightRem,
  );
  const maxHeightPx = effectiveLineHeightPx * maxRows;
  const heightPx = Math.min(
    maxHeightPx,
    Math.max(minHeightPx, effectiveScrollHeightPx),
  );

  return {
    heightPx,
    overflowY: effectiveScrollHeightPx > maxHeightPx ? "auto" : "hidden",
  };
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
