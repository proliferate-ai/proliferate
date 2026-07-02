/** Default rem fallback used when computed textarea line-height is unavailable. */
export const CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM = 1.375;
/** Pixels; keep aligned with the shared ComposerTextarea line-height (14px + 8). */
export const CHAT_COMPOSER_INPUT_LINE_HEIGHT_PX = 22;

export const WORKSPACE_CHAT_COMPOSER_INPUT = {
  minRows: 2,
  maxRows: 16,
  minHeightRem: 2.5,
} as const;

export const HOME_CHAT_COMPOSER_INPUT = {
  minRows: 2,
  maxRows: 8,
  minHeightRem: 2.5,
} as const;
