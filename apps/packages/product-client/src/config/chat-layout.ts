export const CHAT_COLUMN_CLASSNAME = "mx-auto w-full max-w-3xl";
export const CHAT_SURFACE_GUTTER_CLASSNAME = "px-4";

export const CHAT_SCROLL_BASE_BOTTOM_PADDING_PX = 40;
// True visual clearance between the pinned live tail and the dock's top edge.
// Added on top of the measured dock height (which already includes the dock's
// own physical bottom padding), so this is a real on-screen gap — deliberately
// tighter than the canvas padding: the streaming frontier should sit just
// clear of the dock, not float a full padding band above it.
export const CHAT_SCROLL_STICKY_BOTTOM_GAP_PX = 16;
export const CHAT_COMPOSER_SURFACE_SCROLL_OVERLAP_RATIO = 1 / 3;
export const CHAT_COMPOSER_SURFACE_BACKDROP_START_RATIO = 1 / 2;
export const CHAT_DOCK_LOWER_BACKDROP_FADE_HEIGHT_PX = 48;

interface ChatSurfaceBottomInsetArgs {
  dockHeightPx: number;
  composerSurfaceHeightPx: number;
  composerSurfaceOffsetTopPx: number;
  composerFooterHeightPx?: number;
}

export function computeChatSurfaceBottomInsetPx({
  dockHeightPx,
  composerSurfaceHeightPx,
  composerSurfaceOffsetTopPx,
}: ChatSurfaceBottomInsetArgs): number {
  const dockHeight = Math.max(0, Math.ceil(dockHeightPx));
  const surfaceHeight = Math.max(0, composerSurfaceHeightPx);
  const surfaceOffsetTop = Math.max(0, composerSurfaceOffsetTopPx);
  const overlapIntoComposerPx = surfaceHeight * CHAT_COMPOSER_SURFACE_SCROLL_OVERLAP_RATIO;

  return Math.max(
    CHAT_SCROLL_BASE_BOTTOM_PADDING_PX,
    Math.max(0, Math.ceil(dockHeight - surfaceOffsetTop - overlapIntoComposerPx)),
  );
}

export function computeChatStableBottomInsetPx({
  dockHeightPx = 0,
  composerSurfaceHeightPx,
  composerSurfaceOffsetTopPx = 0,
  composerFooterHeightPx = 0,
}: Pick<ChatSurfaceBottomInsetArgs, "composerSurfaceHeightPx" | "composerSurfaceOffsetTopPx" | "composerFooterHeightPx"> & {
  dockHeightPx?: number;
}): number {
  const dockHeight = Math.max(0, Math.ceil(dockHeightPx));
  const surfaceOffsetTop = Math.max(0, Math.ceil(composerSurfaceOffsetTopPx));
  const surfaceHeight = Math.max(0, Math.ceil(composerSurfaceHeightPx));
  const footerHeight = Math.max(0, Math.ceil(composerFooterHeightPx));

  // The measured dock height is authoritative (it includes the dock's own
  // physical padding); the surface-derived sum only covers frames where the
  // dock has not been measured yet.
  const dockReserve = Math.max(dockHeight, surfaceOffsetTop + surfaceHeight + footerHeight);
  return dockReserve + CHAT_SCROLL_STICKY_BOTTOM_GAP_PX;
}

export function computeChatDockLowerBackdropTopPx({
  composerSurfaceHeightPx,
  composerSurfaceOffsetTopPx,
}: Pick<
  ChatSurfaceBottomInsetArgs,
  "composerSurfaceHeightPx" | "composerSurfaceOffsetTopPx"
>): number | null {
  if (composerSurfaceHeightPx <= 0) {
    return null;
  }

  const surfaceOffsetTop = Math.max(0, composerSurfaceOffsetTopPx);
  const backdropStartPx = composerSurfaceHeightPx * CHAT_COMPOSER_SURFACE_BACKDROP_START_RATIO;

  return Math.max(0, Math.ceil(surfaceOffsetTop + backdropStartPx));
}
