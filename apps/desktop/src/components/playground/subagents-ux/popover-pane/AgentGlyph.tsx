import { SubagentIdentityGlyph } from "../identity-receipts/SubagentIdentityGlyph";

export function AgentGlyph({
  id,
  size = 16,
  dimmed = false,
}: {
  id: string;
  size?: number;
  dimmed?: boolean;
}) {
  return <SubagentIdentityGlyph seed={id} size={size} dimmed={dimmed} />;
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
            className="flex size-[18px] items-center justify-center rounded-full bg-popover ring-1 ring-popover-ring"
          >
            <AgentGlyph id={id} size={11} />
          </span>
        ))}
      </span>
      {overflow > 0 ? (
        <span className="ml-1 font-mono text-xs text-muted-foreground">+{overflow}</span>
      ) : null}
    </span>
  );
}
