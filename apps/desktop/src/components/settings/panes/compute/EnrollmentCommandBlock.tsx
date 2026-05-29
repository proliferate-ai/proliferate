import { useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Copy } from "@proliferate/ui/icons";
import { COMPUTE_COPY } from "@/copy/settings/compute";

interface EnrollmentCommandBlockProps {
  command: string;
}

export function EnrollmentCommandBlock({ command }: EnrollmentCommandBlockProps) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-medium text-muted-foreground">
          {COMPUTE_COPY.installCommandLabel}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(command).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          <Copy className="size-3.5" />
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="max-h-44 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed text-foreground whitespace-pre-wrap">
        {command}
      </pre>
    </div>
  );
}
