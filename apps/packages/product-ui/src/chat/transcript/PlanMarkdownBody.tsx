import { twMerge } from "@proliferate/ui/utils/tw-merge";
import {
  MarkdownBody,
  type MarkdownCodeBlockRenderer,
  type MarkdownInlineCodeRenderer,
  type MarkdownLinkRenderer,
} from "./MarkdownBody";

interface PlanMarkdownBodyProps {
  content: string;
  className?: string;
  presentation?: "default" | "proposal";
  renderLink?: MarkdownLinkRenderer;
  renderInlineCode?: MarkdownInlineCodeRenderer;
  renderCodeBlock?: MarkdownCodeBlockRenderer;
}

export function PlanMarkdownBody({
  content,
  className,
  presentation = "default",
  renderLink,
  renderInlineCode,
  renderCodeBlock,
}: PlanMarkdownBodyProps) {
  const proposal = presentation === "proposal";
  const renderedContent = proposal ? annotatePlanSectionHeadings(content) : content;

  return (
    <MarkdownBody
      content={renderedContent}
      renderLink={renderLink}
      renderInlineCode={renderInlineCode}
      renderCodeBlock={renderCodeBlock}
      taskListItems={proposal ? "grid" : "inline"}
      className={twMerge(
        "select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        proposal ? PROPOSED_PLAN_MARKDOWN_CLASSNAME : "",
        className,
      )}
    />
  );
}

const PROPOSED_PLAN_MARKDOWN_CLASSNAME = [
  "text-chat leading-[var(--text-chat--line-height)]",
  // Heading hierarchy: h1/h2 are real section titles, h3 is the uppercase
  // micro-label tier, body stays on the chat scale.
  "[&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-ui [&_h1]:font-semibold [&_h1]:text-foreground",
  "[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-ui [&_h2]:font-semibold [&_h2]:text-foreground",
  "[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-ui-sm [&_h3]:font-semibold [&_h3]:uppercase [&_h3]:tracking-wide [&_h3]:text-muted-foreground",
  "[&_p]:my-1.5 [&_p]:text-chat [&_p]:leading-[var(--text-chat--line-height)]",
  "[&_ol]:mb-4 [&_ol]:mt-1 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_ul]:mb-4 [&_ul]:mt-1 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_li]:mb-0.5 [&_li]:text-chat [&_li]:leading-[var(--text-chat--line-height)] [&_li::marker]:text-muted-foreground",
  // Codex task-list treatment: no markers/indent (the grid columns come from
  // MarkdownBody's grid task-list items) and 0.5rem gaps between items.
  "[&_ul.contains-task-list]:pl-0",
  "[&_li.task-list-item+li.task-list-item]:mt-2",
].join(" ");

/**
 * Rewrites any plan section heading that is immediately followed by an
 * ordered list into "Title (N)" where N counts the section's numbered items.
 * Tolerant on purpose: agents rarely emit a literal "Steps" heading, so the
 * annotation keys off structure rather than the heading's wording.
 */
function annotatePlanSectionHeadings(content: string): string {
  const lines = content.split(/\r?\n/);
  let inCodeFence = false;
  return lines.map((line, index) => {
    const trimmed = line.trim();
    if (CODE_FENCE_PATTERN.test(trimmed)) {
      inCodeFence = !inCodeFence;
      return line;
    }
    if (inCodeFence) {
      return line;
    }
    const headingMatch = /^(#{1,6}\s+)(.+?)(\s+#*)?$/.exec(trimmed);
    if (!headingMatch) {
      return line;
    }
    const headingText = headingMatch[2] ?? "";
    // Skip headings that already carry a count.
    if (/\(\d+\)$/.test(headingText)) {
      return line;
    }
    if (!isImmediatelyFollowedByOrderedList(lines, index + 1)) {
      return line;
    }
    const stepCount = countFollowingOrderedListItems(lines, index + 1);
    if (stepCount <= 0) {
      return line;
    }
    return `${headingMatch[1]}${headingText} (${stepCount})${headingMatch[3] ?? ""}`;
  }).join("\n");
}

const CODE_FENCE_PATTERN = /^(?:```|~~~)/;

function isImmediatelyFollowedByOrderedList(lines: string[], startIndex: number): boolean {
  for (let index = startIndex; index < lines.length; index += 1) {
    const trimmed = lines[index]?.trim() ?? "";
    if (trimmed.length === 0) {
      continue;
    }
    return /^\d+[.)]\s+\S/.test(trimmed);
  }
  return false;
}

function countFollowingOrderedListItems(lines: string[], startIndex: number): number {
  let count = 0;
  let inCodeFence = false;
  for (let index = startIndex; index < lines.length; index += 1) {
    const trimmed = lines[index]?.trim() ?? "";
    if (CODE_FENCE_PATTERN.test(trimmed)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) {
      continue;
    }
    if (/^#{1,6}\s+\S/.test(trimmed)) {
      break;
    }
    if (/^\d+[.)]\s+\S/.test(trimmed)) {
      count += 1;
    }
  }
  return count;
}
