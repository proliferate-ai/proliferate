/**
 * Shared readable-width contract for transcript, composer, and chat states.
 * [CHAT-04] (ui-foundation-chat-addendum.md RULED block) adopts Codex's
 * 40rem thread readable measure as the `--container-transcript-readable`
 * token; this constant is the one place every chat surface (transcript,
 * composer, empty/loading states) shares that cap, replacing the prior
 * hand-authored 46rem arbitrary bracket value.
 */
export const CHAT_COLUMN_CLASSNAME = "mx-auto w-full max-w-transcript-readable";
export const CHAT_SURFACE_GUTTER_CLASSNAME = "px-4";
