import {
  createContext,
  createElement,
  useContext,
  type ContextType,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import {
  useChatContentSearchPaint,
  type ChatContentSearchPaint,
} from "./ChatContentSearchContext";
import { markSearchChildren } from "./MarkdownContentSearchMarks";
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

export const MarkdownCodeBlockContext = createContext(false);

// Message prose reads at --prose-text-size, which the assistant/user message
// wrappers set to --text-message (the composer size). Every other MarkdownBody
// context — tool-row detail bodies, plan cards, work history — leaves the var
// unset, so the fallback keeps that secondary chrome on --text-chat while
// conversation bodies grow to match the composer. Authenticated CSS owns the
// scoped font-size and line-height so chat rules stay out of the login bundle.
export const LI_CLASSNAME = "pl-0.5";
// Prose elements (paragraphs, headings, lists, blockquotes) fill the full
// shared 40rem thread column — the same width as wide blocks (tables, code),
// the composer below, and the new-chat flow — so the measure does not change
// when a session starts. See the single-measure note on `markdownClassName`.
export const PROSE_MEASURE_CLASSNAME = "max-w-full";

// Markdown component overrides are the React element *types* for every
// rendered node. They must be referentially stable across renders: a fresh
// arrow function per render is a new component type, which makes React
// unmount and remount the whole markdown DOM (visible as transcript jumps
// while streams/sends re-render rows).

// Factory: creates a stable component that reads the search context and
// delegates without rebuilding the components map (see the identity comment).
function mdComponent(tag: MdTag, className: string) {
  return (props: MdElementProps) => {
    const revealState = useContext(MarkdownRevealContext);
    const searchPaint = useChatContentSearchPaint();
    return mdHtmlElement(tag, className, props, revealState, searchPaint);
  };
}

export const STATIC_MARKDOWN_COMPONENTS = {
  h1: mdComponent("h1", `mb-2.5 mt-5 ${PROSE_MEASURE_CLASSNAME} text-title font-semibold text-foreground`),
  h2: mdComponent("h2", `mb-2.5 mt-5 ${PROSE_MEASURE_CLASSNAME} text-heading font-semibold text-foreground`),
  h3: mdComponent("h3", `mb-2.5 mt-5 ${PROSE_MEASURE_CLASSNAME} text-body-emphasis font-semibold text-foreground`),
  h4: mdComponent("h4", `mb-2 mt-4 ${PROSE_MEASURE_CLASSNAME} text-body-emphasis font-semibold text-foreground`),
  h5: mdComponent("h5", `mb-1.5 mt-4 ${PROSE_MEASURE_CLASSNAME} font-semibold uppercase tracking-wide text-muted-foreground`),
  h6: mdComponent("h6", `mb-1.5 mt-4 ${PROSE_MEASURE_CLASSNAME} font-semibold uppercase tracking-wide text-muted-foreground`),
  strong: mdComponent("strong", "font-semibold"),
  em: mdComponent("em", "italic"),
  del: mdComponent("del", "line-through"),
  p: mdComponent("p", `mb-[0.6875rem] mt-0 ${PROSE_MEASURE_CLASSNAME} text-foreground`),
  ul: mdComponent("ul", `mb-[0.6875rem] mt-0 ${PROSE_MEASURE_CLASSNAME} list-disc pl-[1.3125rem] text-foreground [&>li+li]:mt-2`),
  ol: mdComponent("ol", `mb-[0.6875rem] mt-0 ${PROSE_MEASURE_CLASSNAME} list-decimal pl-[1.3125rem] text-foreground [&>li+li]:mt-2`),
  li: mdComponent("li", LI_CLASSNAME),
  blockquote: mdComponent("blockquote", `my-3 ${PROSE_MEASURE_CLASSNAME} border-l-4 border-border pl-6 py-2 text-foreground`),
  hr: () => <hr className="my-3 border-border" />,
  table: (props: MdElementProps) => (
    // ui-foundation-escalation: [CHAT-04]'s RULED block adopts
    // --container-transcript-wide (56rem) for wide blocks like this table.
    // This table uses the full 48rem --container-transcript-thread column
    // (like all prose — see markdownClassName), but 56rem exceeds that column
    // — reaching it would need a breakout (negative-margin / container-
    // query) restructure applied at every MarkdownBody consumer (transcript
    // rows, plan cards, tool-detail panels). That restructure is out of
    // scope for this pass; this table stays at max-w-full
    // (container-relative to the 48rem shared chat column) as a conscious
    // partial adoption rather than an unreachable cap.
    <div
      className="my-4 min-w-0 max-w-full overflow-hidden rounded-lg border"
      data-markdown-table-shell="true"
      data-wide-markdown-block="true"
      data-wide-markdown-block-kind="table"
    >
      <div
        className="max-w-full overflow-x-auto overscroll-x-none"
        data-markdown-table-scroll="true"
      >
        {mdHtmlElement(
          "table",
          "w-max min-w-full max-w-none border-collapse [&_tbody_tr:nth-child(2n)]:bg-surface-elevated-secondary [&_tbody_tr:last-child_td]:border-b-0",
          props,
        )}
      </div>
    </div>
  ),
  th: mdComponent("th", "border-b bg-surface-elevated-secondary px-3 py-2 text-left font-medium text-foreground"),
  td: mdComponent("td", "border-b px-3 py-2 align-top"),
  pre: ({ children, dangerouslySetInnerHTML, node: _node, ...rest }: MdElementProps & { children?: ReactNode }) => {
    if (dangerouslySetInnerHTML) {
      return <pre {...rest} dangerouslySetInnerHTML={dangerouslySetInnerHTML} />;
    }
    return (
      <MarkdownCodeBlockContext.Provider value>
        {children}
      </MarkdownCodeBlockContext.Provider>
    );
  },
};

// mdHtmlElement is called from within STATIC_MARKDOWN_COMPONENTS entries,
// which ARE React component functions (hooks-valid call site).
export function mdHtmlElement(
  tag: MdTag,
  baseClassName: string,
  props: MdElementProps,
  revealState: ContextType<typeof MarkdownRevealContext> = null,
  searchPaint: ChatContentSearchPaint | null = null,
) {
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
