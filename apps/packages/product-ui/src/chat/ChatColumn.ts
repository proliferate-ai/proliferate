/**
 * Shared readable-width contract for transcript, composer, and chat states.
 * [CHAT-04] (ui-foundation-chat-addendum.md RULED block) adopts the reference
 * ramp's 40rem thread readable measure as the `--container-transcript-readable`
 * token, replacing the prior hand-authored 46rem arbitrary bracket value.
 *
 * Two-tier measure: the thread *column* (this classname — avatars, action
 * rows, wide blocks like tables/code) now widens to the 48rem
 * `--container-transcript-thread` token, while the Markdown prose body
 * itself keeps the tighter 40rem readable cap applied directly on
 * `.chat-markdown` (see MarkdownBody.tsx). This is what lets a wide code
 * block or table breathe without widening the text column that sits above
 * and below it.
 */
export const CHAT_COLUMN_CLASSNAME = "mx-auto w-full max-w-transcript-thread";
export const CHAT_SURFACE_GUTTER_CLASSNAME = "px-4";
