import { SubagentIdentityGlyph } from "#product/components/playground/subagents-ux/identity-receipts/SubagentIdentityGlyph";

export function AgentGlyph({
  id,
  dimmed = false,
  className = "text-ui icon-control",
}: {
  id: string;
  dimmed?: boolean;
  className?: string;
}) {
  return <SubagentIdentityGlyph seed={id} dimmed={dimmed} className={className} />;
}

/**
 * Overlapping avatar stack for the aggregate popover: up to `max` glyphs on a
 * popover-colored keyline, then a mono "+N" overflow count. Aggregate-only —
 * no names, no per-agent affordances.
 */
export function AgentGlyphStack({
  ids,
  max = 4,
}: {
  ids: readonly string[];
  max?: number;
}) {
  const shown = ids.slice(0, max);
  const overflow = ids.length - shown.length;
  return (
    <span className="flex items-center">
      <span className="flex items-center -space-x-1.5">
        {shown.map((id) => (
          <span
            key={id}
            className="flex size-5 items-center justify-center rounded-full bg-popover ring-1 ring-border"
          >
            <AgentGlyph id={id} className="text-ui-sm icon-compact" />
          </span>
        ))}
      </span>
      {overflow > 0 ? (
        <span className="ml-1 font-mono text-ui-sm text-muted-foreground">+{overflow}</span>
      ) : null}
    </span>
  );
}
