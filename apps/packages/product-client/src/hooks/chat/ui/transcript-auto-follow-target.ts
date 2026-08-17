/**
 * Resolve the scrollTop the transcript should follow to while pinned. With no
 * remaining manual inset the target is the raw scrollHeight (browsers clamp it
 * to their exact maximum scrollTop without subpixel bookkeeping); a remaining
 * inset holds the follow a fixed distance above the hard bottom so a card
 * overlaying the composer does not cover the newest content.
 */
export function resolveAutoFollowScrollTop(
  viewport: HTMLDivElement,
  bottomInsetPx: number,
  consumedBottomInsetPx: number,
): number {
  const remainingManualInsetPx = Math.max(0, bottomInsetPx - consumedBottomInsetPx);
  if (remainingManualInsetPx <= 0) {
    return viewport.scrollHeight;
  }
  const hardBottom = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  return Math.max(0, hardBottom - remainingManualInsetPx);
}
