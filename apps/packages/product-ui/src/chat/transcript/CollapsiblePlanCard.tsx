import { useState, type ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Check, ChevronDown, Copy } from "@proliferate/ui/icons";
import { PlanMarkdownBody } from "./PlanMarkdownBody";
import type {
  MarkdownCodeBlockRenderer,
  MarkdownInlineCodeRenderer,
  MarkdownLinkRenderer,
} from "./MarkdownBody";

interface CollapsiblePlanCardProps {
  title: string;
  content: string;
  subtitle?: ReactNode;
  note?: ReactNode;
  footer?: ReactNode;
  emptyContent: string;
  copyLabel: string;
  collapseLabel: string;
  expandLabel: string;
  initialExpanded?: boolean;
  density?: "default" | "compact";
  markdownPresentation?: "default" | "proposal";
  renderLink?: MarkdownLinkRenderer;
  renderInlineCode?: MarkdownInlineCodeRenderer;
  renderCodeBlock?: MarkdownCodeBlockRenderer;
}

const COLLAPSED_MAX_HEIGHT = "min(20rem,45vh)";
// Expanded plans still cap out and scroll internally so a long plan cannot
// fill the whole transcript.
const EXPANDED_MAX_HEIGHT = "60vh";
const COLLAPSED_FADE =
  "linear-gradient(to bottom, black 0, black calc(100% - 5rem), transparent 100%)";

export function CollapsiblePlanCard({
  title,
  content,
  subtitle,
  note,
  footer,
  emptyContent,
  copyLabel,
  collapseLabel,
  expandLabel,
  initialExpanded = true,
  density = "default",
  markdownPresentation = "default",
  renderLink,
  renderInlineCode,
  renderCodeBlock,
}: CollapsiblePlanCardProps) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [copied, setCopied] = useState(false);
  const hasContent = content.length > 0;
  const renderedContent = stripDuplicatePlanHeading(content, title);
  const compact = density === "compact";
  // One shell language for every plan surface; density only changes padding
  // and title size.
  const shellClassName =
    "relative overflow-clip rounded-lg border border-border/70 bg-card/85 text-left";
  const headerClassName = compact
    ? "relative flex items-center justify-between gap-3 border-b border-border/40 px-2.5 py-1.5"
    : "relative flex items-center justify-between gap-3 border-b border-border/40 px-4 py-3";
  const titleClassName = compact
    ? "truncate text-ui-sm font-semibold leading-tight text-foreground"
    : "truncate text-ui font-semibold leading-tight text-foreground";

  const handleCopy = () => {
    if (!content) return;
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div data-telemetry-mask className={shellClassName}>
      <div className={headerClassName}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={titleClassName}>
            {title.trim() || "Plan"}
          </span>
          {subtitle}
        </div>
        {hasContent && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-chat-transcript-ignore
              onClick={handleCopy}
              aria-label={copyLabel}
              className="size-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-chat-transcript-ignore
              onClick={() => setExpanded((value) => !value)}
              aria-label={expanded ? collapseLabel : expandLabel}
              className="size-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronDown
                className={`size-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`}
              />
            </Button>
          </div>
        )}
      </div>
      {note}
      {!hasContent ? (
        <div className="px-4 py-3 text-sm text-muted-foreground">
          {emptyContent}
        </div>
      ) : expanded ? (
        <div
          className={compact ? "overflow-y-auto px-3 py-2" : "overflow-y-auto px-4 py-3"}
          style={{ maxHeight: EXPANDED_MAX_HEIGHT }}
        >
          <PlanMarkdownBody
            content={renderedContent}
            presentation={markdownPresentation}
            renderLink={renderLink}
            renderInlineCode={renderInlineCode}
            renderCodeBlock={renderCodeBlock}
          />
        </div>
      ) : (
        <div className="relative">
          <div
            className={compact ? "overflow-hidden px-3 py-2" : "overflow-hidden px-4 py-3"}
            style={{
              maxHeight: COLLAPSED_MAX_HEIGHT,
              maskImage: COLLAPSED_FADE,
              WebkitMaskImage: COLLAPSED_FADE,
            }}
          >
            <PlanMarkdownBody
              content={renderedContent}
              presentation={markdownPresentation}
              renderLink={renderLink}
              renderInlineCode={renderInlineCode}
            />
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <Button
              type="button"
              variant="inverted"
              size="pill"
              data-chat-transcript-ignore
              onClick={() => setExpanded(true)}
              className="pointer-events-auto px-3 py-0.5 text-sm"
            >
              Expand plan
            </Button>
          </div>
        </div>
      )}
      {footer}
    </div>
  );
}

function stripDuplicatePlanHeading(content: string, title: string): string {
  const lines = content.split(/\r?\n/);
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex < 0) {
    return content;
  }

  const firstLine = lines[firstContentIndex]?.trim() ?? "";
  const heading = /^(?:#{1,3}\s+)(.+?)(?:\s+#*)?$/.exec(firstLine)?.[1]?.trim();
  if (!heading) {
    return content;
  }

  if (normalizeHeading(heading) !== normalizeHeading(title.trim() || "Plan")) {
    return content;
  }

  return [
    ...lines.slice(0, firstContentIndex),
    ...lines.slice(firstContentIndex + 1),
  ].join("\n").replace(/^\s*\n/, "");
}

function normalizeHeading(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
