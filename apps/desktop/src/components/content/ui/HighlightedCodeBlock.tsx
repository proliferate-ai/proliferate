import { useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { CodeBlockTokenContent } from "@proliferate/product-ui/code/CodeBlockTokenContent";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useHighlightedTokens } from "@/hooks/ui/highlighting/use-highlighted-tokens";

interface HighlightedCodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  showLanguageLabel?: boolean;
  showCopyButton?: boolean;
  showLineNumbers?: boolean;
  lineNumberStart?: number;
  className?: string;
  contentClassName?: string;
}

/**
 * Desktop code panel with token-based highlighting. Replaces the old
 * HighlightedCodePanel that used HTML + dangerouslySetInnerHTML.
 */
export function HighlightedCodeBlock({
  code,
  language,
  filename,
  showLanguageLabel = true,
  showCopyButton = true,
  showLineNumbers = false,
  lineNumberStart = 1,
  className = "",
  contentClassName = "",
}: HighlightedCodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const { writeText } = useProductHost().clipboard;

  const resolvedLang = language ?? filename ?? "text";
  const displayLang = language ?? filename?.split(".").pop() ?? "";
  const tokens = useHighlightedTokens(code, resolvedLang);

  const handleCopy = () => {
    void writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`group/code relative overflow-clip rounded-lg border border-input bg-[var(--color-code-block-background,var(--color-card))] ${className}`}>
      {(showLanguageLabel || showCopyButton) && (
        <div className="sticky top-0 z-10 flex items-center justify-between px-2 py-1 text-sm text-muted-foreground select-none">
          {showLanguageLabel && displayLang ? (
            <span className="min-w-0 truncate">{displayLang}</span>
          ) : <span />}
          {showCopyButton && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-6 rounded-md bg-transparent px-1.5 py-0 text-sm text-muted-foreground opacity-0 transition-colors hover:bg-muted hover:text-foreground group-hover/code:opacity-100"
              aria-label="Copy"
            >
              {copied ? "Copied!" : "Copy"}
            </Button>
          )}
        </div>
      )}

      <div className={`overflow-x-auto overflow-y-auto p-2 font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] font-medium ${contentClassName}`}>
        {tokens ? (
          <CodeBlockTokenContent
            lines={tokens}
            showLineNumbers={showLineNumbers}
            lineNumberStart={lineNumberStart}
            className="text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] text-foreground"
          />
        ) : (
          <pre className="m-0 p-0">
            <code className="whitespace-pre font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] font-medium text-foreground">
              {code}
            </code>
          </pre>
        )}
      </div>
    </div>
  );
}
