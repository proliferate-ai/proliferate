import { createContext, type ReactNode } from "react";

export interface MarkdownRevealState {
  enabled: boolean;
  /** Live-markdown source offset before which words have finished fading. */
  revealedUpTo: number;
}

export const MarkdownRevealContext =
  createContext<MarkdownRevealState | null>(null);

export interface HastNode {
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
  children?: HastNode[];
}

/**
 * Wrap only the live suffix's words. A word keeps its animation class for the
 * entire reveal window, so a later word can begin while earlier animations are
 * still running. Stable source-order keys let React preserve those animations
 * across the controller's paced content commits.
 */
export function revealChildren(
  children: ReactNode,
  node: HastNode | undefined,
  state: MarkdownRevealState | null,
): ReactNode {
  if (!state?.enabled) {
    return children;
  }

  const elementStart = node?.position?.start.offset ?? 0;
  const elementEnd = node?.position?.end.offset;
  if (elementEnd !== undefined && elementEnd <= state.revealedUpTo) {
    return children;
  }

  return wrapChildren(children, elementStart, state.revealedUpTo);
}

function wrapChildren(
  children: ReactNode,
  elementStart: number,
  revealedUpTo: number,
): ReactNode {
  if (typeof children === "string") {
    return splitWords(children, elementStart, revealedUpTo);
  }
  if (!Array.isArray(children)) {
    return children;
  }

  let sourceOffset = elementStart;
  return children.map((child) => {
    if (typeof child === "string") {
      const wrapped = splitWords(child, sourceOffset, revealedUpTo);
      sourceOffset += child.length;
      return wrapped;
    }

    const childNode = getHastNode(child);
    const childEnd = childNode?.position?.end.offset;
    sourceOffset = childEnd ?? sourceOffset + estimateTextLength(child);
    return child;
  });
}

function splitWords(
  text: string,
  sourceStart: number,
  revealedUpTo: number,
): ReactNode[] {
  if (/^\s*$/.test(text)) {
    return [text];
  }

  const parts = text.split(/(\s+)/);
  let localOffset = 0;
  let animatedStart = text.length;
  for (const part of parts) {
    const partOffset = localOffset;
    localOffset += part.length;
    if (part && !/^\s+$/.test(part) && sourceStart + partOffset >= revealedUpTo) {
      animatedStart = partOffset;
      break;
    }
  }

  if (animatedStart >= text.length) {
    return [text];
  }

  const result: ReactNode[] = [];
  if (animatedStart > 0) {
    result.push(text.slice(0, animatedStart));
  }

  localOffset = animatedStart;
  for (const part of text.slice(animatedStart).split(/(\s+)/)) {
    const sourceOffset = sourceStart + localOffset;
    localOffset += part.length;
    if (!part || /^\s+$/.test(part)) {
      result.push(part);
    } else {
      result.push(
        <span className="stream-word" key={sourceOffset}>
          {part}
        </span>,
      );
    }
  }
  return result;
}

function getHastNode(value: unknown): HastNode | undefined {
  if (!value || typeof value !== "object" || !("props" in value)) {
    return undefined;
  }
  return (value as { props?: { node?: HastNode } }).props?.node;
}

function estimateTextLength(value: unknown): number {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).length;
  }
  if (!value || typeof value !== "object" || !("props" in value)) {
    return 0;
  }
  const children = (value as { props?: { children?: unknown } }).props?.children;
  if (Array.isArray(children)) {
    return children.reduce(
      (total: number, child: unknown) => total + estimateTextLength(child),
      0,
    );
  }
  return estimateTextLength(children);
}
