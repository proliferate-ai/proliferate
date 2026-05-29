import { twMerge } from "tailwind-merge";
import { MarkdownRenderer } from "@/components/ui/content/MarkdownRenderer";

interface PlanMarkdownBodyProps {
  content: string;
  className?: string;
  presentation?: "default" | "proposal";
}

export function PlanMarkdownBody({
  content,
  className,
  presentation = "default",
}: PlanMarkdownBodyProps) {
  const proposal = presentation === "proposal";
  const renderedContent = proposal ? annotatePlanSectionHeadings(content) : content;

  return (
    <MarkdownRenderer
      content={renderedContent}
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
  "[&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-sm [&_h1]:font-semibold [&_h1]:uppercase [&_h1]:tracking-wide [&_h1]:text-muted-foreground",
  "[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:uppercase [&_h2]:tracking-wide [&_h2]:text-muted-foreground",
  "[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:uppercase [&_h3]:tracking-wide [&_h3]:text-muted-foreground",
  "[&_p]:my-1.5 [&_p]:text-chat [&_p]:leading-[var(--text-chat--line-height)]",
  "[&_ol]:mb-4 [&_ol]:mt-1 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_ul]:mb-4 [&_ul]:mt-1 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_li]:mb-0.5 [&_li]:text-chat [&_li]:leading-[var(--text-chat--line-height)] [&_li::marker]:text-muted-foreground",
].join(" ");

function annotatePlanSectionHeadings(content: string): string {
  const lines = content.split(/\r?\n/);
  return lines.map((line, index) => {
    const headingMatch = /^(#{1,6}\s+)steps(\s+#*)?$/i.exec(line.trim());
    if (!headingMatch) {
      return line;
    }

    const stepCount = countFollowingOrderedListItems(lines, index + 1);
    if (stepCount <= 0) {
      return line;
    }

    return `${headingMatch[1]}Steps · ${stepCount}${headingMatch[2] ?? ""}`;
  }).join("\n");
}

function countFollowingOrderedListItems(lines: string[], startIndex: number): number {
  let count = 0;
  for (let index = startIndex; index < lines.length; index += 1) {
    const trimmed = lines[index]?.trim() ?? "";
    if (/^#{1,6}\s+\S/.test(trimmed)) {
      break;
    }
    if (/^\d+[.)]\s+\S/.test(trimmed)) {
      count += 1;
    }
  }
  return count;
}
