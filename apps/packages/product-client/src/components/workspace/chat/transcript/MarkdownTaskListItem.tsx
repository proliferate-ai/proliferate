import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { LI_CLASSNAME, mdHtmlElement, type MdElementProps } from "./MarkdownHtmlElement";

// Plan-view task-list grid: checkbox column sized auto, content column
// minmax(0,1fr). react-markdown emits tight task items as
// `li > input + <inline content>` (and loose ones with the input inside the
// leading <p>), so a pure-CSS grid would scatter the inline runs across
// cells; instead the item is restructured into checkbox + content wrapper.
export function GridTaskListItem(props: MdElementProps & { children?: ReactNode }) {
  const { children, dangerouslySetInnerHTML, className, node: _node, ...rest } = props;
  const isTaskListItem =
    typeof className === "string" && className.includes("task-list-item");
  const split = isTaskListItem && !dangerouslySetInnerHTML
    ? splitTaskListItemChildren(children)
    : null;
  if (!split) {
    return mdHtmlElement("li", LI_CLASSNAME, props);
  }
  const mergedClassName = [
    LI_CLASSNAME,
    "grid grid-cols-[auto_minmax(0,1fr)]",
    className,
  ].filter(Boolean).join(" ");
  return (
    <li {...rest} className={mergedClassName}>
      {cloneElement(split.checkbox, {
        // Nudge: drop the checkbox 0.25rem so it optically centers on
        // the first text line.
        className: [split.checkbox.props.className, "mt-1"].filter(Boolean).join(" "),
      })}
      <div className="min-w-0">{split.content}</div>
    </li>
  );
}

interface SplitTaskListItem {
  checkbox: ReactElement<{ className?: string }>;
  content: ReactNode[];
}

function splitTaskListItemChildren(children: ReactNode): SplitTaskListItem | null {
  const nodes = Children.toArray(children);
  // Tight items: the checkbox input is a direct child of the <li>.
  const inputIndex = nodes.findIndex(isCheckboxElement);
  if (inputIndex >= 0) {
    return {
      checkbox: nodes[inputIndex] as SplitTaskListItem["checkbox"],
      content: [...nodes.slice(0, inputIndex), ...nodes.slice(inputIndex + 1)],
    };
  }
  // Loose items: the checkbox sits at the head of the leading paragraph.
  const paragraphIndex = nodes.findIndex(
    (node) => isValidElement(node) && hastTagName(node) === "p",
  );
  if (paragraphIndex < 0) {
    return null;
  }
  const paragraph = nodes[paragraphIndex] as ReactElement<{ children?: ReactNode }>;
  const paragraphChildren = Children.toArray(paragraph.props.children);
  const nestedInputIndex = paragraphChildren.findIndex(isCheckboxElement);
  if (nestedInputIndex < 0) {
    return null;
  }
  const strippedParagraph = cloneElement(paragraph, undefined, ...[
    ...paragraphChildren.slice(0, nestedInputIndex),
    ...paragraphChildren.slice(nestedInputIndex + 1),
  ]);
  return {
    checkbox: paragraphChildren[nestedInputIndex] as SplitTaskListItem["checkbox"],
    content: [
      ...nodes.slice(0, paragraphIndex),
      strippedParagraph,
      ...nodes.slice(paragraphIndex + 1),
    ],
  };
}

function isCheckboxElement(node: ReactNode): boolean {
  return isValidElement(node) && node.type === "input";
}

function hastTagName(node: ReactElement): string | null {
  const hast = (node.props as { node?: { tagName?: unknown } }).node;
  return typeof hast?.tagName === "string" ? hast.tagName : null;
}
