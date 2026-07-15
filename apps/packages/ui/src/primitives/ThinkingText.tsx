import { useMemo, type CSSProperties, type HTMLAttributes } from "react";
import { twMerge } from "../utils/tw-merge";

export interface ThinkingTextProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  text?: string;
  /** Epoch that keeps remounted copies on the same global gleam phase. */
  motionOriginMs?: number | null;
}

const THINKING_TEXT_DURATION_MS = 1_800;
type ThinkingTextStyle = CSSProperties & { "--thinking-text-delay"?: string };

/**
 * The product's one "agent is working" text treatment: a dim muted label with
 * a light left→right gleam. Motion comes from `.thinking-text*` (design
 * dom.css) — a masked band window and its counter-translated bright glyph copy
 * each animate transform in lockstep, so the gleam is compositor-only and
 * cannot jitter or bump layout while the main thread is busy. Reduced motion
 * renders a calm static label. Shared so desktop and the cloud/web chat
 * surfaces speak one thinking language.
 */
export function ThinkingText({
  className,
  text = "Thinking",
  motionOriginMs = null,
  style,
  ...props
}: ThinkingTextProps) {
  const phaseStyle = useMemo<ThinkingTextStyle | null>(() => {
    if (motionOriginMs === null || !Number.isFinite(motionOriginMs)) {
      return null;
    }
    const elapsedMs = Math.max(0, Date.now() - motionOriginMs);
    return {
      "--thinking-text-delay": `${-(elapsedMs % THINKING_TEXT_DURATION_MS)}ms`,
    };
  }, [motionOriginMs]);

  return (
    <span
      {...props}
      style={phaseStyle ? { ...style, ...phaseStyle } : style}
      className={twMerge(
        "thinking-text inline-block text-chat font-medium leading-[var(--text-chat--line-height)]",
        className,
      )}
      data-text={text}
      data-thinking-text
    >
      {text}
      {/* Light gleam, compositor-only: the band window and its counter-
          translated bright glyph copy each animate transform in lockstep, so
          the sweep cannot jitter while the main thread is busy. */}
      <span className="thinking-text-band" aria-hidden="true">
        <span className="thinking-text-band-glyphs">{text}</span>
      </span>
    </span>
  );
}
