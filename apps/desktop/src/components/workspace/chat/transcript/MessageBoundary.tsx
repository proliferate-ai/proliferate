/**
 * Subtle hairline divider inserted between two adjacent assistant-message
 * blocks within a single turn, so consecutive assistant messages (Codex packs
 * several per turn; Claude can emit prose → thought → more prose) read as
 * distinct messages instead of one wall of text.
 *
 * Deliberately quieter than the labeled "Final message" `TurnSeparator` used in
 * the collapsed work-history group: a single low-contrast full-width rule with
 * no label, using the muted transcript chrome tokens. Marked
 * `data-chat-transcript-ignore` so it never leaks into copied transcript text.
 */
export function MessageBoundary() {
  return (
    <div
      aria-hidden="true"
      data-chat-transcript-ignore
      className="border-t border-border/40"
    />
  );
}
