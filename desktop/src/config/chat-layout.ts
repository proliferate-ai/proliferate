export const CHAT_COLUMN_CLASSNAME = "mx-auto w-full max-w-3xl";
export const CHAT_SURFACE_GUTTER_CLASSNAME = "px-4";

export const CHAT_SCROLL_BASE_BOTTOM_PADDING_PX = 40;
export const CHAT_COMPOSER_SURFACE_SCROLL_OVERLAP_RATIO = 1 / 3;
export const CHAT_COMPOSER_SURFACE_BACKDROP_START_RATIO = 1 / 2;
export const CHAT_DOCK_LOWER_BACKDROP_FADE_HEIGHT_PX = 48;

interface ChatSurfaceBottomInsetArgs {
  dockHeightPx: number;
  composerSurfaceHeightPx: number;
  composerSurfaceOffsetTopPx: number;
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

export function computeChatStickyBottomInsetPx(dockHeightPx: number): number {
  const dockHeight = Math.max(0, Math.ceil(dockHeightPx));

  return dockHeight + CHAT_SCROLL_BASE_BOTTOM_PADDING_PX;
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
