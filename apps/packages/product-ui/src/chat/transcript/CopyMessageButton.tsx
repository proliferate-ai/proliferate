import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { IconButton } from "@proliferate/ui/primitives/IconButton";

export function CopyMessageButton({
  content,
  timestampLabel = null,
  timestampPosition = "before",
  visibilityClassName,
}: {
  content: string;
  timestampLabel?: string | null;
  timestampPosition?: "before" | "after";
  visibilityClassName: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const timestamp = timestampLabel
    ? <span className="tabular-nums">{timestampLabel}</span>
    : null;
  const copyButton = (
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
  );

  return (
    <span className={`inline-flex items-center gap-1 text-xs text-muted-foreground transition-opacity duration-200 ${visibilityClassName}`}>
      {timestampPosition === "before" && timestamp}
      {copyButton}
      {timestampPosition === "after" && timestamp}
    </span>
  );
}
