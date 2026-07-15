import { useState, type ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Check, Copy } from "@proliferate/ui/icons";

/**
 * Codex-style code block card: bordered rounded shell with a header carrying
 * the language label and an always-visible copy icon button. `children`
 * overrides the rendered code content (e.g. app-injected highlighted HTML);
 * `code` remains the copy payload and the plain-text fallback.
 */
export function MarkdownCodeBlockShell({
  code,
  label,
  children,
}: {
  code: string;
  label?: string | null;
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  function copyCode() {
    void writeClipboardText(code)
      .then((copiedSuccessfully) => {
        if (!copiedSuccessfully) {
          return;
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      });
  }

  return (
    <div className="relative my-[14px] w-full min-w-0 overflow-clip rounded-lg border border-transparent bg-[var(--color-code-block-background,var(--color-card))]">
      <div className="flex select-none items-center justify-between gap-2 py-1 pl-2 pr-1.5 text-[length:var(--text-chat-meta,11px)] text-muted-foreground">
        {label ? <span className="min-w-0 flex-1 truncate">{label}</span> : <span className="min-w-0 flex-1" />}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={copyCode}
          className="size-6 shrink-0 rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Copy code"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
      <div className="overflow-x-auto overflow-y-auto p-2 font-mono text-[length:var(--text-chat)] font-normal leading-[1.5] [&_pre]:!m-0 [&_pre]:!p-0 [&_pre]:!bg-transparent [&_code]:text-[length:var(--text-chat)] [&_code]:leading-[1.5]">
        {children ?? (
          <pre className="m-0 p-0">
            <code className="whitespace-pre font-mono text-[length:var(--text-chat)] font-normal leading-[1.5] text-foreground">
              {code}
            </code>
          </pre>
        )}
      </div>
    </div>
  );
}

async function writeClipboardText(value: string): Promise<boolean> {
  if (writeClipboardTextFallback(value)) {
    return true;
  }
  const clipboard = navigator.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function writeClipboardTextFallback(value: string): boolean {
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "true");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  input.style.top = "0";
  document.body.appendChild(input);
  input.focus();
  input.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(input);
  }
}
