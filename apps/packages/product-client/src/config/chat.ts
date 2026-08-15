/** Default rem fallback used when computed textarea line-height is unavailable. */
export const CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM = 1.375;

export const WORKSPACE_CHAT_COMPOSER_INPUT = {
  minRows: 2,
  maxRows: 16,
  minHeightRem: 2.75,
} as const;

export const HOME_CHAT_COMPOSER_INPUT = {
  minRows: 2,
  maxRows: 8,
  minHeightRem: 2.75,
} as const;

/**
 * Maximum result page supported by workspace file search. The mention menu
 * keeps the full page and scrolls inside its visual height cap.
 */
export const CHAT_FILE_MENTION_SEARCH_LIMIT = 200;

/** File-picker accept list for the composer's attach (+) button, shared by the
 * chat and home composers. Mirrors the upload kinds prompts accept (images and
 * text-like context files). */
export const CHAT_INPUT_ATTACHMENT_ACCEPT =
  "image/*,text/*,.md,.json,.ts,.tsx,.js,.jsx,.py,.rs,.go,.java,.css,.html,.xml,.yaml,.yml,.toml,.sql,.sh";
