import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

/**
 * Inline `code` treatment for transcript markdown. Extracted from MarkdownBody
 * so the inline-code presentation (chip surface plus the hex-colour swatch
 * below) has one owner and MarkdownBody keeps only the component map.
 */
export const MARKDOWN_INLINE_CODE_CLASS =
  "rounded-sm bg-[var(--color-code-block-background,var(--color-muted))] px-1 align-baseline font-mono text-foreground";

/**
 * Hex colour literals only: `#rgb`, `#rrggbb`, `#rrggbbaa`. Deliberately NOT a
 * general CSS-colour parser — named colours, `rgb()`/`hsl()` functions and
 * 4-digit `#rgba` are out, and the whole inline-code text must be the literal.
 * Prose that merely contains a `#` (issue numbers, fragments, `#!`/shebangs,
 * markdown headings) therefore never renders a swatch.
 */
const HEX_COLOR_LITERAL_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * The swatch colour for an inline-code string, or null when the string is not a
 * hex literal. Returned lowercase so the value handed to CSS is stable.
 */
export function hexColorSwatchValue(code: string | null | undefined): string | null {
  if (typeof code !== "string") {
    return null;
  }
  const trimmed = code.trim();
  if (!HEX_COLOR_LITERAL_RE.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

type MarkdownInlineCodeProps = HTMLAttributes<HTMLElement> & {
  /** Raw inline-code text, used for hex-literal detection. */
  code?: string;
  children?: ReactNode;
};

export function MarkdownInlineCode({
  code,
  children,
  ...rest
}: MarkdownInlineCodeProps) {
  const swatchColor = hexColorSwatchValue(code);
  return (
    <code
      {...rest}
      className={MARKDOWN_INLINE_CODE_CLASS}
      data-markdown-inline-code="true"
    >
      {swatchColor === null ? null : (
        <span
          aria-hidden="true"
          data-markdown-hex-swatch="true"
          // The colour is data, not palette: it is passed through as a custom
          // property so no literal colour value is authored in source.
          style={{ "--markdown-hex-swatch": swatchColor } as CSSProperties}
          className="icon-tight mr-1 inline-block shrink-0 rounded-sm border border-border/60 bg-[var(--markdown-hex-swatch)] align-middle"
        />
      )}
      {children}
    </code>
  );
}
