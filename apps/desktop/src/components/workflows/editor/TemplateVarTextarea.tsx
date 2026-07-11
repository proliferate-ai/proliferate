import { useRef, type ReactNode } from "react";
import type { TemplateSuggestion } from "@proliferate/product-domain/workflows/interpolation";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@proliferate/ui/primitives/PopoverButton";

export interface TemplateVarTextareaProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: readonly TemplateSuggestion[];
  placeholder?: string;
  rows?: number;
  invalid?: boolean;
  mono?: boolean;
  ariaLabel?: string;
  /** Optional gutter glyph rendered in a fixed left column (e.g. `$` for shell). */
  gutter?: ReactNode;
}

/**
 * A single framed textarea with `{{…}}` autocomplete. The frame carries the
 * border, an optional gutter column (shell `$`), a borderless textarea, and a
 * quiet inserter in the footer — so the affordance never floats over the text
 * and there is exactly one bordered container (Ona shell-editor parity).
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
  gutter,
}: TemplateVarTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const insert = (token: string, close: () => void) => {
    const node = ref.current;
    const caret = node ? node.selectionStart : value.length;
    const next = `${value.slice(0, caret)}${token}${value.slice(caret)}`;
    onChange(next);
    close();
    requestAnimationFrame(() => {
      if (node) {
        const pos = caret + token.length;
        node.focus();
        node.setSelectionRange(pos, pos);
      }
    });
  };

  return (
    <div
      className={twMerge(
        "flex flex-col overflow-hidden rounded-md border bg-surface-elevated-secondary transition-colors focus-within:border-border-heavy focus-within:ring-1 focus-within:ring-ring",
        invalid ? "border-destructive/60" : "border-border",
      )}
    >
      <div className="flex min-h-0">
        {gutter ? (
          <div
            aria-hidden
            className="shrink-0 select-none border-r border-border px-2.5 py-2 font-mono text-sm leading-[1.45] text-faint"
          >
            {gutter}
          </div>
        ) : null}
        <Textarea
          ref={ref}
          variant="ghost"
          value={value}
          rows={rows}
          aria-label={ariaLabel}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          data-telemetry-mask
          spellCheck={mono ? false : undefined}
          className={twMerge(
            "w-full flex-1 resize-y border-none bg-transparent px-3 py-2 text-sm leading-[1.45] text-foreground outline-none placeholder:text-muted-foreground focus:ring-0",
            mono ? "font-mono" : "",
          )}
        />
      </div>
      {suggestions.length > 0 ? (
        <div className="flex justify-end border-t border-border bg-surface-elevated-secondary/50 px-1.5 py-1">
          <PopoverButton
            align="end"
            side="top"
            className={`w-64 ${POPOVER_SURFACE_CLASS}`}
            trigger={(
              <Button
                type="button"
                variant="unstyled"
                size="unstyled"
                className="rounded-md px-1.5 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-list-hover hover:text-foreground"
                title="Insert variable"
              >
                {"{{ }}"}
              </Button>
            )}
          >
            {(close) => (
              <div className="p-1">
                {suggestions.map((suggestion) => (
                  <Button
                    key={suggestion.token}
                    type="button"
                    variant="unstyled"
                    size="unstyled"
                    onClick={() => insert(suggestion.token, close)}
                    className="flex w-full flex-col items-start rounded-lg px-2 py-1 text-left hover:bg-list-hover"
                  >
                    <span className="font-mono text-xs text-foreground">{suggestion.label}</span>
                    <span className="text-xs text-faint">{suggestion.detail}</span>
                  </Button>
                ))}
              </div>
            )}
          </PopoverButton>
        </div>
      ) : null}
    </div>
  );
}
