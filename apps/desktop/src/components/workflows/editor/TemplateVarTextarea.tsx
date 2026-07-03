import { useRef, useState } from "react";
import type { TemplateSuggestion } from "@proliferate/product-domain/workflows/interpolation";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { twMerge } from "@proliferate/ui/utils/tw-merge";

export interface TemplateVarTextareaProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: readonly TemplateSuggestion[];
  placeholder?: string;
  rows?: number;
  invalid?: boolean;
  mono?: boolean;
  ariaLabel?: string;
}

/**
 * A textarea with `{{…}}` autocomplete: an inserter menu offering exactly the
 * valid template tokens for this step (args + strictly-earlier step outputs,
 * from the product-domain parser). Tokens are inserted at the caret.
 */
export function TemplateVarTextarea({
  value,
  onChange,
  suggestions,
  placeholder,
  rows = 4,
  invalid = false,
  mono = false,
  ariaLabel,
}: TemplateVarTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);

  const insert = (token: string) => {
    const node = ref.current;
    const caret = node ? node.selectionStart : value.length;
    const next = `${value.slice(0, caret)}${token}${value.slice(caret)}`;
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      if (node) {
        const pos = caret + token.length;
        node.focus();
        node.setSelectionRange(pos, pos);
      }
    });
  };

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        rows={rows}
        aria-label={ariaLabel}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        data-telemetry-mask
        className={twMerge(
          "w-full resize-y",
          mono ? "font-mono text-ui-sm" : "",
          invalid ? "border-destructive/60" : "",
        )}
      />
      {suggestions.length > 0 ? (
        <div className="absolute right-1.5 top-1.5">
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:text-foreground"
            title="Insert variable"
          >
            {"{{ }}"}
          </button>
          {open ? (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
              <div className="absolute right-0 z-20 mt-1 max-h-56 w-64 overflow-auto rounded-md border border-border bg-background p-1 shadow-md">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.token}
                    type="button"
                    onClick={() => insert(suggestion.token)}
                    className="flex w-full flex-col items-start rounded px-2 py-1 text-left hover:bg-foreground/[0.05]"
                  >
                    <span className="font-mono text-xs text-foreground">{suggestion.label}</span>
                    <span className="text-xs text-faint">{suggestion.detail}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
