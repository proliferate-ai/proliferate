import { twMerge } from "@proliferate/ui/utils/tw-merge";

export interface WorkflowStepGlyphStripProps {
  glyphs: readonly string[];
  className?: string;
}

/** The compact step-glyph strip on a workflow home card (`◇ $ ⇈ 🔔`). */
export function WorkflowStepGlyphStrip({ glyphs, className = "" }: WorkflowStepGlyphStripProps) {
  if (glyphs.length === 0) {
    return null;
  }
  return (
    <span
      className={twMerge("inline-flex items-center gap-1 font-mono text-xs text-muted-foreground", className)}
      aria-label={`${glyphs.length} steps`}
    >
      {glyphs.map((glyph, index) => (
        <span key={index} aria-hidden className="leading-none">
          {glyph}
        </span>
      ))}
    </span>
  );
}
