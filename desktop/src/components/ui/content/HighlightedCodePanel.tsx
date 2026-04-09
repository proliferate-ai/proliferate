import { useState, useEffect, useRef } from "react";
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
            <button
              type="button"
              onClick={handleCopy}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover/code:opacity-100"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          )}
        </div>
      )}

      {showLineNumbers ? (
        <div
          ref={codeRef}
          className={`overflow-x-auto overflow-y-auto font-mono text-sm leading-relaxed font-medium ${contentClassName}`}
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
                      <code className="whitespace-pre text-sm leading-relaxed font-mono font-medium">
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
          className={`overflow-x-auto overflow-y-auto text-sm leading-relaxed font-mono font-medium [&_.shiki]:!bg-transparent [&_pre]:!bg-transparent [&_pre]:p-3 [&_pre]:!m-0 [&_code]:text-sm [&_code]:leading-relaxed ${contentClassName}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div
          ref={codeRef}
          className={`overflow-x-auto overflow-y-auto text-sm leading-relaxed font-mono font-medium ${contentClassName}`}
        >
          <pre className="p-3 m-0">
            <code className="text-sm leading-relaxed font-mono font-medium text-foreground">{code}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
