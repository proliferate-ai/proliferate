import { useState } from "react";
import { Check, Copy } from "@/components/ui/icons";

export function CopyMessageButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/msg:opacity-100"
    >
      {copied
        ? <Check className="size-3" />
        : <Copy className="size-3" />}
    </button>
  );
}
