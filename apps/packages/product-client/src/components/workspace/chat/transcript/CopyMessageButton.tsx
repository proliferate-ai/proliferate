import { useState } from "react";
import { motion } from "@proliferate/design/motion";
import { Check, Copy } from "#product/primitives/icons/core";
import { IconButton } from "#product/primitives/IconButton";

export function CopyMessageButton({
  content,
  timestampLabel = null,
  timestampPosition = "before",
  visibilityClassName,
  // The copy button and the date are two independently-visible pieces: the
  // final completed message keeps its copy button permanently visible
  // (visibilityClassName can be opacity-100), but the date next to it must
  // stay hover-only on every message, including that one. Defaulting to
  // visibilityClassName preserves the old single-visibility behavior for any
  // caller that doesn't opt into the split.
  timestampVisibilityClassName = visibilityClassName,
}: {
  content: string;
  timestampLabel?: string | null;
  timestampPosition?: "before" | "after";
  visibilityClassName: string;
  timestampVisibilityClassName?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), motion.feedback.copiedResetMs);
    }).catch(() => {});
  };

  const timestamp = timestampLabel
    ? (
      <span
        className={`tabular-nums transition-opacity duration-hover ${timestampVisibilityClassName}`}
      >
        {timestampLabel}
      </span>
    )
    : null;
  const copyButton = (
    <IconButton
      data-chat-transcript-ignore
      size="xs"
      onClick={handleCopy}
      title={copied ? "Copied" : "Copy message"}
      // The "Copy message" button is --color-foreground-tertiary at
      // rest (the same dim tone the adjacent date already uses) — not the
      // brighter muted-foreground.
      className="!size-icon-button-sm !p-0 rounded-full !text-foreground-tertiary hover:!text-foreground"
    >
      {/*
       * The "Copy message" button renders a 16px glyph (icon-xs) against our
       * chat font size of 13px — a 1.230769em ratio, which is exactly
       * --icon-paired (already used for every other small inline glyph in
       * the transcript), not --icon-control (1.333333em, ~17px at this
       * base — visibly larger). Pin the em base to --text-chat explicitly
       * since this button sits in the text-chat-meta (11px) row, same
       * pattern as the pending-interaction and goal-met glyphs elsewhere in
       * the transcript.
       */}
      {copied
        ? <Check className="icon-paired [font-size:var(--text-chat)]" />
        : <Copy className="icon-paired [font-size:var(--text-chat)]" />}
    </IconButton>
  );

  // transform-gpu keeps the span on its own compositor layer at all times.
  // Without it, WebKit promotes the span only while the opacity fade runs,
  // snapping its fractional layout origin to device pixels and visibly
  // nudging the button sideways at the start/end of each fade.
  return (
    <span className={`inline-flex transform-gpu items-center gap-1 text-chat-meta text-foreground-tertiary transition-opacity duration-hover ${visibilityClassName}`}>
      {timestampPosition === "before" && timestamp}
      {copyButton}
      {timestampPosition === "after" && timestamp}
    </span>
  );
}
