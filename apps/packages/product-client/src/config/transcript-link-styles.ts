/**
 * Shared transcript-web-link treatment: one tone, underline-only state changes.
 *
 * A link in prose is not a control, so NO state of it may paint a fill. That has
 * to be stated positively here rather than merely omitted, because some link
 * call sites are `<button>` elements wearing this class (the inline file
 * reference in FileReferenceBadge is a real button so it can open the workspace
 * viewer and carry a context menu). Those inherit the ghost button's
 * `hover:bg-hover`/`active:bg-active` state fills, and the class list is merged
 * with tailwind-merge, which resolves same-group conflicts by LAST wins — so the
 * explicit `*:bg-transparent` entries below are what actually cancel them. Drop
 * them and a link flashes a grey box while the mouse is down, which is what
 * "the background has a colour when you click a link" was.
 *
 * Keyboard focus stays visible without a fill: `focus-visible` draws the same
 * underline hover draws, at 1px instead of hover's hairline 0.5px, so a focused
 * link is distinguishable from a merely hovered one by weight alone. The native
 * focus ring is suppressed because an inline link's box is the text run itself —
 * a ring around a mid-sentence, possibly line-wrapped run reads as a stray
 * rectangle, and the thicker underline is the accessible indicator instead.
 */
export const CHAT_TRANSCRIPT_LINK_CLASS =
  "cursor-pointer text-link-foreground no-underline hover:bg-transparent hover:text-link-foreground hover:underline hover:decoration-current hover:decoration-dotted hover:decoration-[0.5px] hover:underline-offset-2 focus:bg-transparent focus-visible:bg-transparent active:bg-transparent focus-visible:outline-none focus-visible:underline focus-visible:decoration-current focus-visible:decoration-dotted focus-visible:decoration-1 focus-visible:underline-offset-2";
