import {
  createContext,
  useContext,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";

/**
 * Inline `code` treatment for transcript markdown. Extracted from MarkdownBody
 * so the inline-code presentation (chip surface plus the hex-colour swatch
 * below) has one owner and MarkdownBody keeps only the component map.
 */
export const MARKDOWN_INLINE_CODE_CLASS =
  "rounded-sm bg-[var(--color-code-block-background,var(--color-muted))] px-1 align-baseline font-mono text-foreground";

/**
 * What kind of text a MarkdownBody is rendering.
 *
 * "message" is conversation content — what a human typed and what an agent
 * wrote back, plus the plan/tool prose that hangs off a turn. "file-content" is
 * a file's own bytes rendered through the markdown pipeline (the file viewer's
 * rendered-markdown mode).
 *
 * The distinction exists because reading affordances that help in a conversation
 * are noise in a document. The hex-colour swatch is the first of them: a colour
 * value mentioned in a message is a value someone is talking about and worth
 * previewing, while a `#rrggbb` inside a stylesheet or a design doc is just part
 * of the text being displayed, and annotating file bytes with chips the file
 * does not contain misrepresents the file.
 */
export type MarkdownSurface = "message" | "file-content";

/**
 * Defaults to "message" deliberately, and this is an opt-OUT rather than an
 * opt-in: nearly every MarkdownBody in the product renders conversation content
 * (transcript messages, plan cards, tool detail bodies, subagent ledgers,
 * prompt previews), and only the file viewer renders file bytes. Defaulting the
 * other way would silently strip the affordance from every chat surface the day
 * someone adds a new one and forgets the prop — the failure we want is the loud
 * one (a swatch appears somewhere it shouldn't and is reported), not the quiet
 * one.
 */
const MarkdownSurfaceContext = createContext<MarkdownSurface>("message");

export const MarkdownSurfaceProvider = MarkdownSurfaceContext.Provider;

export function useMarkdownSurface(): MarkdownSurface {
  return useContext(MarkdownSurfaceContext);
}

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
  // One owner for the detection (hexColorSwatchValue) and one owner for the
  // scope decision: the surface gate is applied here, not duplicated at call
  // sites, so a new consumer cannot accidentally get half of the rule.
  const surface = useMarkdownSurface();
  const swatchColor = surface === "message" ? hexColorSwatchValue(code) : null;
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
