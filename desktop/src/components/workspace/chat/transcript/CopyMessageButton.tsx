import { useState } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { Check, Copy } from "@/components/ui/icons";

export function CopyMessageButton({
  content,
  visibilityClassName,
}: {
  content: string;
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
    <IconButton
      onClick={handleCopy}
      title={copied ? "Copied" : "Copy message"}
      className={`rounded-md text-muted-foreground transition-opacity duration-200 hover:text-foreground ${visibilityClassName}`}
    >
      {copied
        ? <Check className="size-3" />
        : <Copy className="size-3" />}
    </IconButton>
  );
}
