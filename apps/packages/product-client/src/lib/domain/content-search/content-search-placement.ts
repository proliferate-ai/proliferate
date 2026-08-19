export type ContentSearchSurface = "chat" | "file" | "review";

/**
 * Fixed shell geometry the placement contract is derived from (see 02B spec
 * "Fixed composition and geometry"). These are shell-owned constants, not
 * measurements: every surface's own header renders at exactly this height.
 */
export const SHELL_TAB_STRIP_HEIGHT = 46;
export const SURFACE_HEADER_HEIGHT = 36;
export const SEARCH_BELOW_HEADER_GAP = 8;
export const SEARCH_CONTENT_EDGE_INSET = 16;

/** 46px tab strip + 36px owned header + 8px gap, per the frozen spec. */
export const FILE_OR_REVIEW_SEARCH_TOP = SHELL_TAB_STRIP_HEIGHT + SURFACE_HEADER_HEIGHT + SEARCH_BELOW_HEADER_GAP;
/** 46px tab strip + 8px gap: chat has no owned sub-header. */
export const CHAT_SEARCH_TOP = SHELL_TAB_STRIP_HEIGHT + SEARCH_BELOW_HEADER_GAP;

export interface ContentSearchPillPlacementInput {
  surface: ContentSearchSurface;
  /** Whether the right panel rail currently participates in layout. */
  rightPanelOpen: boolean;
  /** Rail content width when open, pre-floor-clamp (caller's raw state). */
  rightPanelWidth: number;
  /** `RIGHT_PANEL_MIN_WIDTH` from the right-panel model, passed in rather than imported twice. */
  rightPanelMinWidth: number;
}

export interface ContentSearchPillPlacement {
  /** Offset from the shell's top edge, in pixels. */
  top: number;
  /** Offset from the shell's right edge, in pixels. */
  right: number;
}

/**
 * Resolves the shell-owned `ContentSearchPill`'s position from surface data
 * and layout tokens only — no DOM measurement of arbitrary descendants.
 *
 * `file` and `review` content regions (`[data-file-viewer-content]`,
 * `[data-git-review-document]`) already sit flush against the shell's right
 * edge inside the right-panel rail, so a fixed 16px inset from the shell edge
 * lands exactly 16px from either content region's edge regardless of rail
 * width or an open file-tree dock (the dock occupies space to the content
 * region's left, never inside it). `chat` has no rail alongside it, so its
 * inset must additionally clear the rail's own width when the rail is open.
 */
export function resolveContentSearchPillPlacement(
  input: ContentSearchPillPlacementInput,
): ContentSearchPillPlacement {
  const { surface, rightPanelOpen, rightPanelWidth, rightPanelMinWidth } = input;
  const effectiveRailWidth = rightPanelOpen
    ? Math.max(rightPanelWidth, rightPanelMinWidth)
    : 0;

  if (surface === "chat") {
    return {
      top: CHAT_SEARCH_TOP,
      right: SEARCH_CONTENT_EDGE_INSET + effectiveRailWidth,
    };
  }

  return {
    top: FILE_OR_REVIEW_SEARCH_TOP,
    right: SEARCH_CONTENT_EDGE_INSET,
  };
}

/**
 * Side clearance the pill keeps within a content region of `contentWidth`
 * once it is right-aligned `insetRight` from that region's edge. Used to
 * prove the 380px right-panel content floor still leaves at least 16px of
 * clearance on the pill's other side per the frozen spec.
 */
export function computeContentSearchPillSideClearance(
  contentWidth: number,
  pillWidth: number,
  insetRight: number,
): number {
  return contentWidth - insetRight - pillWidth;
}
