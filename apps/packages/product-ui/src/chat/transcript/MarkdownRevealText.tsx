import { createContext, type ReactNode } from "react";

/**
 * Reveal context value. `null` = disabled (no animation). When enabled,
 * `revealedUpTo` is the character offset into the live content string:
 * everything before it was already rendered in a prior frame and must render
 * static (no animation class); words at/after it are new and animate.
 */
export interface MarkdownRevealState {
  enabled: boolean;
  revealedUpTo: number;
}

/** Stable default for non-reveal renders — avoids re-creating context value. */
const DISABLED: MarkdownRevealState | null = null;

export const MarkdownRevealContext = createContext<MarkdownRevealState | null>(
  DISABLED,
);

/** Convenience: create a disabled context value without allocation. */
export const REVEAL_DISABLED = DISABLED;

/**
 * Hast Element node shape (subset used for position offsets).
 * react-markdown passes the hast `node` in props for custom components.
 */
export interface HastNode {
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
  children?: Array<{ type: string; value?: string; position?: HastNode["position"]; children?: HastNode["children"] }>;
}

/**
 * Transform children for word-level reveal animation. Splits string children
 * on whitespace boundaries: whitespace segments pass through as plain strings,
 * non-whitespace segments get wrapped in `<span className="stream-word">` if
 * their estimated source offset is >= revealedUpTo (new text). Words before
 * revealedUpTo render as plain `<span>` without animation class, preserving
 * positional key parity so React doesn't remount animated siblings.
 *
 * Non-string children (elements like strong/em/code) pass through untouched —
 * their OWN inner strings will get wrapped when they render through
 * mdHtmlElement recursively.
 */
export function revealChildren(
  children: ReactNode,
  node: HastNode | undefined,
  ctx: MarkdownRevealState | null,
): ReactNode {
  // Fast path: no reveal context or disabled — return children as-is.
  if (!ctx || !ctx.enabled) {
    return children;
  }

  const elementStartOffset = node?.position?.start?.offset ?? undefined;
  const elementEndOffset = node?.position?.end?.offset ?? undefined;

  // If the entire element is before revealedUpTo, return children as plain
  // text — no spans at all, zero overhead for settled elements.
  if (
    elementEndOffset !== undefined &&
    elementEndOffset <= ctx.revealedUpTo
  ) {
    return children;
  }

  // If the entire element is new (starts at or after revealedUpTo), animate
  // all words.
  if (
    elementStartOffset !== undefined &&
    elementStartOffset >= ctx.revealedUpTo
  ) {
    return wrapAllAnimated(children);
  }

  // Element straddles the boundary. Walk children and estimate offsets.
  return wrapStraddling(children, node, ctx);
}

/**
 * All words in these children are new — wrap with stream-word class.
 */
function wrapAllAnimated(children: ReactNode): ReactNode {
  if (typeof children === "string") {
    return splitIntoWordSpans(children, true);
  }
  if (Array.isArray(children)) {
    return children.map((child) => {
      if (typeof child === "string") {
        return splitIntoWordSpans(child, true);
      }
      return child;
    });
  }
  return children;
}

/**
 * Element straddles the revealedUpTo boundary. Estimate per-word offsets
 * relative to the source string and decide animate vs. static.
 */
function wrapStraddling(
  children: ReactNode,
  node: HastNode | undefined,
  ctx: MarkdownRevealState,
): ReactNode {
  const elementStart = node?.position?.start?.offset ?? 0;
  let charAccumulator = elementStart;

  if (typeof children === "string") {
    return splitIntoWordSpansWithOffset(children, charAccumulator, ctx.revealedUpTo);
  }

  if (Array.isArray(children)) {
    return children.map((child) => {
      if (typeof child === "string") {
        const result = splitIntoWordSpansWithOffset(child, charAccumulator, ctx.revealedUpTo);
        charAccumulator += child.length;
        return result;
      }
      // Non-string child (React element): advance accumulator by its source
      // extent if available, else estimate via textContent.
      const childNode = getHastNodeFromElement(child);
      if (childNode?.position?.end?.offset !== undefined) {
        charAccumulator = childNode.position.end.offset;
      } else {
        charAccumulator += estimateTextLength(child);
      }
      return child;
    });
  }

  return children;
}

/**
 * Split a string into word spans with offset-aware animation decisions.
 * Words whose estimated start offset < revealedUpTo render static (span
 * without animation class). Words at/after render animated.
 */
function splitIntoWordSpansWithOffset(
  text: string,
  startOffset: number,
  revealedUpTo: number,
): ReactNode[] {
  if (/^\s*$/.test(text)) {
    return [text];
  }
  const parts = text.split(/(\s+)/);
  let localOffset = 0;
  return parts.map((part, index) => {
    if (/^\s+$/.test(part)) {
      localOffset += part.length;
      return part;
    }
    if (part === "") {
      return null;
    }
    const wordStartOffset = startOffset + localOffset;
    localOffset += part.length;
    // Bias toward static: use < (not <=) so words exactly at boundary are
    // treated as new, but any drift from markdown syntax chars means some
    // new-ish words render static — acceptable (invisible vs. blip).
    const isSettled = wordStartOffset < revealedUpTo;
    return (
      <span className={isSettled ? undefined : "stream-word"} key={index}>
        {part}
      </span>
    );
  });
}

function splitIntoWordSpans(text: string, animate: boolean): ReactNode[] {
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
    if (animate) {
      return (
        <span className="stream-word" key={index}>
          {part}
        </span>
      );
    }
    return (
      <span key={index}>
        {part}
      </span>
    );
  });
}

/**
 * Extract hast node from a React element's props (react-markdown passes it as
 * `node` prop on custom components).
 */
function getHastNodeFromElement(element: unknown): HastNode | undefined {
  if (
    element &&
    typeof element === "object" &&
    "props" in element &&
    (element as { props?: { node?: HastNode } }).props?.node
  ) {
    return (element as { props: { node: HastNode } }).props.node;
  }
  return undefined;
}

/**
 * Cheap recursive textContent estimate for a React element (used when hast
 * position is unavailable on a child element).
 */
function estimateTextLength(element: unknown): number {
  if (typeof element === "string") return element.length;
  if (typeof element === "number") return String(element).length;
  if (!element || typeof element !== "object") return 0;
  if ("props" in element) {
    const props = (element as { props?: { children?: unknown } }).props;
    if (!props?.children) return 0;
    const children = props.children;
    if (typeof children === "string") return children.length;
    if (Array.isArray(children)) {
      return children.reduce(
        (sum: number, child: unknown) => sum + estimateTextLength(child),
        0,
      );
    }
    return estimateTextLength(children);
  }
  return 0;
}
