import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import type { RecognizedSlashCommand } from "@/lib/domain/chat/composer/slash-command-recognition";

interface ComposerSlashHighlightProps {
  recognition: RecognizedSlashCommand;
  text: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

/**
 * Overlay decoration painted ABOVE the textarea (absolutely positioned, so it
 * paints over the in-flow textarea, whose text turns transparent while a
 * command is recognized). Mirrors the textarea's full text with identical font
 * metrics; the recognized command token is styled with the link-foreground
 * accent color, the rest in normal foreground. The layer is pointer-events-none
 * so typing/caret/selection stay native; only the command span is
 * pointer-events-auto so hover triggers the Tooltip. Mousedown on the span
 * hands the caret back to the textarea (placed after the token).
 */
export function ComposerSlashHighlight({
  recognition,
  text,
  textareaRef,
}: ComposerSlashHighlightProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const syncScroll = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      setScrollTop((prev) => prev === textarea.scrollTop ? prev : textarea.scrollTop);
    }
  }, [textareaRef]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.addEventListener("scroll", syncScroll, { passive: true });
    return () => textarea.removeEventListener("scroll", syncScroll);
  }, [syncScroll, textareaRef]);

  // Programmatic value changes (command replacement) and autosize height
  // changes move scrollTop without firing a scroll event — re-sync on text.
  useLayoutEffect(() => {
    syncScroll();
  }, [syncScroll, text]);

  const { command, start, end } = recognition;
  // Render the literal draft slice (not displayName): the overlay must mirror
  // the textarea glyph-for-glyph or the two layers drift apart.
  const token = text.slice(start, end);
  const tooltipContent = command.description
    ? `${command.displayName} — ${command.description}`
    : `${command.displayName} — slash command`;

  const before = text.slice(0, start);
  const after = text.slice(end);

  // The command span intercepts pointer events (for the tooltip), so clicking
  // it must hand the caret back to the textarea, after the token.
  const handleTokenMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(end, end);
      }
    },
    [end, textareaRef],
  );

  return (
    <div
      ref={overlayRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div
        className="whitespace-pre-wrap break-words text-composer leading-[var(--text-composer--line-height)] text-foreground"
        style={{
          padding: 0,
          transform: `translateY(-${scrollTop}px)`,
        }}
      >
        {before}
        <Tooltip
          content={tooltipContent}
          singleLine
          className="pointer-events-auto inline"
        >
          <span
            className="cursor-text rounded-sm text-link-foreground"
            onMouseDown={handleTokenMouseDown}
          >
            {token}
          </span>
        </Tooltip>
        {after}
      </div>
    </div>
  );
}
