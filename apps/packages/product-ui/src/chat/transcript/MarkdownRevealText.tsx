import { createContext, type ReactNode } from "react";

/**
 * Context that enables word-level fade-in on streamed text. When true,
 * mdHtmlElement wraps each word in a `.stream-word` span so new words animate
 * in via CSS (opacity-only, no layout shift). Only the LIVE MarkdownBody sets
 * this to true; the stable prefix never animates.
 */
export const MarkdownRevealContext = createContext(false);

/**
 * Transform children for word-level reveal animation. Splits string children
 * on whitespace boundaries: whitespace segments pass through as plain strings,
 * non-whitespace segments get wrapped in `<span className="stream-word">`.
 *
 * Non-string children (elements like strong/em/code) pass through untouched —
 * their OWN inner strings will get wrapped when they render through
 * mdHtmlElement recursively.
 */
export function revealChildren(children: ReactNode): ReactNode {
  if (typeof children === "string") {
    return splitIntoWordSpans(children);
  }
  if (Array.isArray(children)) {
    return children.map((child) => {
      if (typeof child === "string") {
        return splitIntoWordSpans(child);
      }
      return child;
    });
  }
  return children;
}

function splitIntoWordSpans(text: string): ReactNode[] {
  // Whitespace-only strings pass through untouched.
  if (/^\s*$/.test(text)) {
    return [text];
  }
  const parts = text.split(/(\s+)/);
  return parts.map((part, index) => {
    // Whitespace segments stay as plain text (no span).
    if (/^\s+$/.test(part)) {
      return part;
    }
    if (part === "") {
      return null;
    }
    // Index keys == positional reconciliation: the live tail only appends, so
    // an existing word keeps its index, its span survives reconciliation, and
    // its fade never replays (critical for the anchor invariant).
    return (
      <span className="stream-word" key={index}>
        {part}
      </span>
    );
  });
}

