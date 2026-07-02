import type { ChangeEvent, ReactNode } from "react";

import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { twMerge } from "@proliferate/ui/utils/tw-merge";

export interface ScriptBlockProps {
  ariaLabel: string;
  fileLabel: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  headerAction?: ReactNode;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Script editor chrome: a code-block frame with a mono file-label header strip
 * over a ghost textarea body. No copy button or file chips — nothing renders
 * here without a wired action behind it.
 */
export function ScriptBlock({
  ariaLabel,
  fileLabel,
  value,
  placeholder,
  disabled = false,
  headerAction = null,
  onChange,
  className,
}: ScriptBlockProps) {
  return (
    <div className={twMerge("overflow-hidden rounded-lg border border-border bg-surface-editor", className)}>
      <div className="flex h-8 items-center justify-between border-b border-border-light px-2.5">
        <span className="font-mono text-ui-sm text-muted-foreground">{fileLabel}</span>
        {headerAction}
      </div>
      <Textarea
        variant="ghost"
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        className="min-h-[120px] w-full resize-y px-3 py-2 font-mono text-ui-sm leading-relaxed"
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}
