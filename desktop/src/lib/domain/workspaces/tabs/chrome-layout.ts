export const CHROME_TAB_MIN_WIDTH = 48;
export const CHROME_TAB_COMPACT_WIDTH = 60;
export const CHROME_TAB_SMALL_WIDTH = 84;
export const CHROME_TAB_MAX_WIDTH = 184;
export const CHROME_TAB_CONTENT_MARGIN = 9;
export const CHROME_TAB_CONTENT_OVERLAP_WIDTH = 1;
export const CHROME_TAB_OVERLAP_WIDTH =
  CHROME_TAB_CONTENT_MARGIN * 2 + CHROME_TAB_CONTENT_OVERLAP_WIDTH;
export const TAB_GROUP_PILL_WIDTH = 48;
export const TAB_GROUP_PILL_MAX_WIDTH = 120;
export const TAB_GROUP_PILL_GAP = 4;

export interface ChromeTabLayoutInput {
  containerWidth: number;
  reservedWidth: number;
  tabCount: number;
  minWidth?: number;
  maxWidth?: number;
  overlapWidth?: number;
}

export interface HeaderStripLayoutInput {
  rows: Array<{ kind: "pill" | "tab" }>;
  containerWidth: number;
  reservedWidth?: number;
  minTabWidth?: number;
  maxTabWidth?: number;
  overlapWidth?: number;
  pillWidth?: number;
  pillMaxWidth?: number;
  pillGap?: number;
}

export interface HeaderStripLayout {
  widths: number[];
  positions: number[];
}

export function computeChromeTabWidths({
  containerWidth,
  reservedWidth,
  tabCount,
  minWidth = CHROME_TAB_MIN_WIDTH,
  maxWidth = CHROME_TAB_MAX_WIDTH,
  overlapWidth = CHROME_TAB_OVERLAP_WIDTH,
}: ChromeTabLayoutInput): number[] {
  if (tabCount <= 0) {
    return [];
  }

  const available = Math.max(0, containerWidth - reservedWidth);
  const cumulativeOverlap = Math.max(0, tabCount - 1) * overlapWidth;
  const unclamped = Math.floor((available + cumulativeOverlap) / tabCount);
  const width = Math.min(maxWidth, Math.max(minWidth, unclamped));
  const widths = Array.from({ length: tabCount }, () => width);

  if (width !== unclamped || available <= 0) {
    return widths;
  }

  let remainder = available - (width * tabCount - cumulativeOverlap);
  for (let index = 0; index < widths.length && remainder > 0; index += 1) {
    if (widths[index] < maxWidth) {
      widths[index] += 1;
      remainder -= 1;
    }
  }

  return widths;
}

export function computeChromeTabPositions(
  widths: number[],
  overlapWidth = CHROME_TAB_OVERLAP_WIDTH,
): number[] {
  const positions: number[] = [];
  let position = 0;
  for (const width of widths) {
    positions.push(position);
    position += width - overlapWidth;
  }
  return positions;
}

export function computeHeaderStripLayout({
  rows,
  containerWidth,
  reservedWidth = 0,
  minTabWidth = CHROME_TAB_MIN_WIDTH,
  maxTabWidth = CHROME_TAB_MAX_WIDTH,
  overlapWidth = CHROME_TAB_OVERLAP_WIDTH,
  pillWidth = TAB_GROUP_PILL_WIDTH,
  pillMaxWidth = TAB_GROUP_PILL_MAX_WIDTH,
  pillGap = TAB_GROUP_PILL_GAP,
}: HeaderStripLayoutInput): HeaderStripLayout {
  if (rows.length === 0) {
    return { widths: [], positions: [] };
  }

  const resolvedPillWidth = Math.min(pillMaxWidth, Math.max(0, pillWidth));
  const tabCount = rows.filter((row) => row.kind === "tab").length;
  const pillCount = rows.length - tabCount;
  const nonOverlappedGapCount = rows.slice(0, -1).filter((row, index) =>
    row.kind !== "tab" || rows[index + 1]?.kind !== "tab"
  ).length;
  const adjacentTabOverlapCount = rows.slice(0, -1).filter((row, index) =>
    row.kind === "tab" && rows[index + 1]?.kind === "tab"
  ).length;

  const available = Math.max(0, containerWidth - reservedWidth);
  const fixedWidth = pillCount * resolvedPillWidth + nonOverlappedGapCount * pillGap;
  const tabAvailable = Math.max(0, available - fixedWidth);
  const tabWidths = computeSegmentedTabWidths({
    availableWidth: tabAvailable,
    tabCount,
    overlapCount: adjacentTabOverlapCount,
    minWidth: minTabWidth,
    maxWidth: maxTabWidth,
    overlapWidth,
  });

  const widths: number[] = [];
  const positions: number[] = [];
  let tabIndex = 0;
  let position = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const width = row.kind === "pill"
      ? resolvedPillWidth
      : tabWidths[tabIndex++] ?? minTabWidth;

    widths.push(width);
    positions.push(position);

    const next = rows[index + 1];
    if (!next) {
      continue;
    }
    position += row.kind === "tab" && next.kind === "tab"
      ? width - overlapWidth
      : width + pillGap;
  }

  return { widths, positions };
}

function computeSegmentedTabWidths(args: {
  availableWidth: number;
  tabCount: number;
  overlapCount: number;
  minWidth: number;
  maxWidth: number;
  overlapWidth: number;
}): number[] {
  if (args.tabCount <= 0) {
    return [];
  }

  const cumulativeOverlap = args.overlapCount * args.overlapWidth;
  const unclamped = Math.floor((args.availableWidth + cumulativeOverlap) / args.tabCount);
  const width = Math.min(args.maxWidth, Math.max(args.minWidth, unclamped));
  const widths = Array.from({ length: args.tabCount }, () => width);

  if (width !== unclamped || args.availableWidth <= 0) {
    return widths;
  }

  let remainder = args.availableWidth - (width * args.tabCount - cumulativeOverlap);
  for (let index = 0; index < widths.length && remainder > 0; index += 1) {
    if (widths[index] < args.maxWidth) {
      widths[index] += 1;
      remainder -= 1;
    }
  }

  return widths;
}
