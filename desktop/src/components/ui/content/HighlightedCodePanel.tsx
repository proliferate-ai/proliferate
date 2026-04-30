import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { highlightCode } from "@/lib/infra/highlighting";

interface HighlightedCodePanelProps {
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

export function HighlightedCodePanel({
  code,
  language,
  filename,
  showLanguageLabel = true,
  showCopyButton = true,
  showLineNumbers = false,
  lineNumberStart = 1,
  className = "",
  contentClassName = "",
}: HighlightedCodePanelProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLDivElement>(null);

  const resolvedLang = language ?? filename ?? "text";
  const displayLang = language ?? filename?.split(".").pop() ?? "";
  const codeLines = code.split("\n");

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    void highlightCode(code, resolvedLang).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [code, resolvedLang]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`group/code relative overflow-hidden rounded-md border border-border bg-card ${className}`}>
      {(showLanguageLabel || showCopyButton) && (
        <div className="flex items-center justify-between border-b border-border/50 px-3 py-1">
          {showLanguageLabel && displayLang ? (
            <span className="text-sm text-muted-foreground">{displayLang}</span>
          ) : <span />}
          {showCopyButton && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-auto rounded-none bg-transparent p-0 text-sm text-muted-foreground opacity-0 transition-colors hover:bg-transparent hover:text-foreground group-hover/code:opacity-100"
            >
              {copied ? "Copied!" : "Copy"}
            </Button>
          )}
        </div>
      )}

      {showLineNumbers ? (
        <div
          ref={codeRef}
          className={`overflow-x-auto overflow-y-auto font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] font-medium ${contentClassName}`}
        >
          <div className="min-w-full w-max py-2">
            <table className="border-collapse">
              <tbody>
                {codeLines.map((line, index) => (
                  <tr key={`${lineNumberStart + index}-${line}`}>
                    <td className="select-none px-3 align-top text-right text-[11px] tabular-nums text-faint">
                      {lineNumberStart + index}&#8594;
                    </td>
                    <td className="py-px pr-3 align-top text-foreground">
                      <code className="whitespace-pre font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] font-medium">
                        {line.length > 0 ? line : " "}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : html ? (
        <div
          ref={codeRef}
          className={`overflow-x-auto overflow-y-auto font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] font-medium [&_.shiki]:!bg-transparent [&_pre]:!bg-transparent [&_pre]:p-3 [&_pre]:!m-0 [&_code]:text-[length:var(--readable-code-font-size)] [&_code]:leading-[var(--readable-code-line-height)] ${contentClassName}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div
          ref={codeRef}
          className={`overflow-x-auto overflow-y-auto font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] font-medium ${contentClassName}`}
        >
          <pre className="p-3 m-0">
            <code className="font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] font-medium text-foreground">{code}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
