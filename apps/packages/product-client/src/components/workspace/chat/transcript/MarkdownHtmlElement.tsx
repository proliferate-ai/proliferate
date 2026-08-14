import {
  createElement,
  type ContextType,
  type HTMLAttributes,
  type ReactElement,
} from "react";
import { markSearchChildren } from "./MarkdownContentSearchMarks";
import type { ChatContentSearchPaint } from "./ChatContentSearchContext";
import {
  type HastNode,
  MarkdownRevealContext,
  revealChildren,
} from "./MarkdownRevealText";

export type MdElementProps = HTMLAttributes<HTMLElement> & {
  node?: unknown;
};

export type MdTag =
  | "blockquote"
  | "del"
  | "em"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "li"
  | "ol"
  | "p"
  | "strong"
  | "table"
  | "td"
  | "th"
  | "ul";

export const LI_CLASSNAME = "pl-0.5";

/**
 * Render one markdown node as its HTML element, merging the override's base
 * class with whatever react-markdown supplied and running the children through
 * exactly one of the two text-decoration layers: content-search highlighting
 * when a paint is active, otherwise streaming word reveal.
 *
 * Called from within the markdown component overrides, which ARE React
 * component functions, so the hook-reading callers stay hooks-valid.
 */
export function mdHtmlElement(
  tag: MdTag,
  baseClassName: string,
  props: MdElementProps,
  revealState: ContextType<typeof MarkdownRevealContext> = null,
  searchPaint: ChatContentSearchPaint | null = null,
): ReactElement {
  const {
    children,
    dangerouslySetInnerHTML,
    className,
    node,
    ...rest
  } = props;
  const mergedClassName = [baseClassName, className].filter(Boolean).join(" ");

  if (dangerouslySetInnerHTML) {
    return createElement(tag, {
      ...rest,
      className: mergedClassName,
      dangerouslySetInnerHTML,
    });
  }
  const finalChildren = searchPaint
    ? markSearchChildren(children, searchPaint.query, searchPaint.rowUnitId)
    : revealChildren(children, node as HastNode | undefined, revealState);
  return createElement(tag, { ...rest, className: mergedClassName }, finalChildren);
}
