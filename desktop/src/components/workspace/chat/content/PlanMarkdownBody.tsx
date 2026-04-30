import { twMerge } from "tailwind-merge";
import { MarkdownRenderer } from "@/components/ui/content/MarkdownRenderer";

interface PlanMarkdownBodyProps {
  content: string;
  className?: string;
}

export function PlanMarkdownBody({
  content,
  className,
}: PlanMarkdownBodyProps) {
  return (
    <MarkdownRenderer
      content={content}
      className={twMerge(
        "select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
    />
  );
}
