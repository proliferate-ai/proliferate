import { useState } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { Check, Copy } from "@/components/ui/icons";

export function CopyMessageButton({
  content,
  timestampLabel = null,
  visibilityClassName,
}: {
  content: string;
  timestampLabel?: string | null;
  visibilityClassName: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <span className={`inline-flex items-center gap-1 text-xs text-muted-foreground transition-opacity duration-200 ${visibilityClassName}`}>
      {timestampLabel && (
        <span className="tabular-nums">{timestampLabel}</span>
      )}
      <IconButton
        data-chat-transcript-ignore
        onClick={handleCopy}
        title={copied ? "Copied" : "Copy message"}
        className="rounded-md text-muted-foreground hover:text-foreground"
      >
        {copied
          ? <Check className="size-3" />
          : <Copy className="size-3" />}
      </IconButton>
    </span>
  );
}
