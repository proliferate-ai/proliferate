import type { HTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

interface ThinkingTextProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  text?: string;
}

export function ThinkingText({
  className,
  text = "Thinking",
  ...props
}: ThinkingTextProps) {
  return (
    <span
      {...props}
      className={twMerge(
        "thinking-text inline-block text-chat font-medium leading-[var(--text-chat--line-height)]",
        className,
      )}
      data-text={text}
      data-thinking-text
    >
      {text}
      {/* Codex-style dim band, compositor-only: the band window and its
          counter-translated glyph copy each animate transform in lockstep,
          so the sweep cannot jitter while the main thread is busy. */}
      <span className="thinking-text-band" aria-hidden="true">
        <span className="thinking-text-band-glyphs">{text}</span>
      </span>
    </span>
  );
}
