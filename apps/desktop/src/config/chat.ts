/** Default rem fallback used when computed textarea line-height is unavailable. */
export const CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM = 1.375;

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
