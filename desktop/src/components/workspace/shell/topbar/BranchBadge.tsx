import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Check, Copy } from "@/components/ui/icons";

export function BranchBadge({ branchName }: { branchName: string }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(branchName);
    setCopied(true);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => setCopied(false), 1500);
  }, [branchName]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className="group h-7 min-w-0 max-w-[200px] justify-start gap-1 px-1.5 py-0 text-sm font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
      title="Click to copy branch"
    >
      <span className="truncate">{branchName}</span>
      <span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
        {copied ? (
          <Check className="size-2.5 text-git-green" />
        ) : (
          <Copy className="size-2.5" />
        )}
      </span>
    </Button>
  );
}
