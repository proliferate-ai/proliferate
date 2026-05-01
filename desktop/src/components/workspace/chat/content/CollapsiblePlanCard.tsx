import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Check, ChevronDown, Copy } from "@/components/ui/icons";
import { PlanMarkdownBody } from "@/components/workspace/chat/content/PlanMarkdownBody";

interface CollapsiblePlanCardProps {
  title: string;
  content: string;
  subtitle?: ReactNode;
  footer?: ReactNode;
  emptyContent: string;
  copyLabel: string;
  collapseLabel: string;
  expandLabel: string;
  initialExpanded?: boolean;
}

const COLLAPSED_MAX_HEIGHT = "min(20rem,45vh)";
const COLLAPSED_FADE =
  "linear-gradient(to bottom, black 0, black calc(100% - 5rem), transparent 100%)";

export function CollapsiblePlanCard({
  title,
  content,
  subtitle,
  footer,
  emptyContent,
  copyLabel,
  collapseLabel,
  expandLabel,
  initialExpanded = true,
}: CollapsiblePlanCardProps) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [copied, setCopied] = useState(false);
  const hasContent = content.length > 0;

  const handleCopy = () => {
    if (!content) return;
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div
      data-telemetry-mask
      className="relative overflow-clip rounded-lg bg-foreground/5 text-left"
    >
      <div className="relative flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-base font-semibold leading-tight text-foreground">
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
              className="size-6 text-muted-foreground hover:bg-muted hover:text-foreground"
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
              className="size-6 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronDown
                className={`size-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`}
              />
            </Button>
          </div>
        )}
      </div>
      {!hasContent ? (
        <div className="px-4 py-3 text-sm text-muted-foreground">
          {emptyContent}
        </div>
      ) : expanded ? (
        <div className="px-4 py-3">
          <PlanMarkdownBody content={content} />
        </div>
      ) : (
        <div className="relative">
          <div
            className="overflow-hidden px-4 py-3"
            style={{
              maxHeight: COLLAPSED_MAX_HEIGHT,
              maskImage: COLLAPSED_FADE,
              WebkitMaskImage: COLLAPSED_FADE,
            }}
          >
            <PlanMarkdownBody content={content} />
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
