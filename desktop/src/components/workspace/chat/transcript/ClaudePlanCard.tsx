import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { MarkdownRenderer } from "@/components/ui/content/MarkdownRenderer";
import { Check, ChevronDown, Copy } from "@/components/ui/icons";
// ClaudePlanCard renders Claude's ExitPlanMode plan body as a transcript
// artifact. Header shape mirrors Codex's reference plan card: just "Plan"
// label + small icon-only action buttons. No leading icon.

interface ClaudePlanCardProps {
  content: string;
  isStreaming: boolean;
}

const COLLAPSED_MAX_HEIGHT = "min(20rem,45vh)";
const COLLAPSED_FADE =
  "linear-gradient(to bottom, black 0, black calc(100% - 5rem), transparent 100%)";

export function ClaudePlanCard({ content, isStreaming }: ClaudePlanCardProps) {
  const [expanded, setExpanded] = useState(true);
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
      data-chat-selection-unit
      className="relative overflow-clip rounded-lg bg-foreground/5"
    >
      <div className="relative flex items-center justify-between gap-2 px-3 py-2">
        <span className="text-base font-semibold leading-tight text-foreground">Plan</span>
        {hasContent && (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={handleCopy}
              aria-label="Copy plan"
              className="size-6 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Collapse plan summary" : "Expand plan summary"}
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
          {isStreaming ? "Preparing plan…" : "No plan content"}
        </div>
      ) : expanded ? (
        <div className="px-4 py-3">
          <MarkdownRenderer
            content={content}
            className="select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
          />
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
            <MarkdownRenderer
              content={content}
              className="select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
            />
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <Button
              type="button"
              variant="inverted"
              size="pill"
              onClick={() => setExpanded(true)}
              className="pointer-events-auto px-3 py-0.5 text-sm"
            >
              Expand plan
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
