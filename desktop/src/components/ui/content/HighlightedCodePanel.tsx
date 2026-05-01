import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useHighlightedCode } from "@/hooks/ui/use-highlighted-code";

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
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLDivElement>(null);

  const resolvedLang = language ?? filename ?? "text";
  const displayLang = language ?? filename?.split(".").pop() ?? "";
  const codeLines = code.split("\n");
  const html = useHighlightedCode(code, resolvedLang);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
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

      {showLineNumbers ? (
        <div
          ref={codeRef}
          className={`overflow-x-auto overflow-y-auto p-2 font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] font-medium ${contentClassName}`}
        >
          <div className="min-w-full w-max">
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
          className={`overflow-x-auto overflow-y-auto p-2 font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] font-medium [&_.shiki]:!bg-transparent [&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-0 [&_code]:text-[length:var(--readable-code-font-size)] [&_code]:leading-[var(--readable-code-line-height)] ${contentClassName}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div
          ref={codeRef}
          className={`overflow-x-auto overflow-y-auto p-2 font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] font-medium ${contentClassName}`}
        >
          <pre className="m-0 p-0">
            <code className="font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] font-medium text-foreground">{code}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
