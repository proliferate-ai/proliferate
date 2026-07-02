/** Default rem fallback used when computed textarea line-height is unavailable. */
export const CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM = 1;
/** CSS length; keep aligned with the shared ComposerTextarea line-height. */
export const CHAT_COMPOSER_INPUT_LINE_HEIGHT_CSS = "calc(var(--text-chat, 12px) + 8px)";

export const WORKSPACE_CHAT_COMPOSER_INPUT = {
  minRows: 2,
  maxRows: 16,
  minHeightRem: 2.5,
} as const;

export const HOME_CHAT_COMPOSER_INPUT = {
  minRows: 2,
  maxRows: 8,
  minHeightRem: 6.5,
} as const;
