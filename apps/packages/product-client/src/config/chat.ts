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

/**
 * How many of the workspace's workflow runs the `@` mention menu reads context
 * docs from, newest-first with active runs prioritized. Bounded because each
 * run costs one projection fetch when the menu opens; four mirrors the ruled
 * visible-run cap on the workspace's run rails, so the menu and the pane agree
 * about which runs are "current".
 */
export const CHAT_CONTEXT_DOC_MENTION_RUN_LIMIT = 4;

/** File-picker accept list for the composer's attach (+) button, shared by the
 * chat and home composers. Mirrors the upload kinds prompts accept (images and
 * text-like context files). */
export const CHAT_INPUT_ATTACHMENT_ACCEPT =
  "image/*,text/*,.md,.json,.ts,.tsx,.js,.jsx,.py,.rs,.go,.java,.css,.html,.xml,.yaml,.yml,.toml,.sql,.sh";
