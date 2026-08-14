import {
  AgentIdentityGlyph,
  type AgentIdentityGlyphDimension,
} from "#product/components/patterns/AgentIdentityGlyph";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";

/**
 * Dev-lab adapter around the production UI-R01 identity primitive. Fixture
 * seeds stand in for durable session IDs so the isolated lab renders the exact
 * Solid Seal used by product transcript, row, stack, and detail surfaces.
 */
export function SubagentIdentityGlyph({
  seed,
  dimmed = false,
  dimension,
  className = "text-ui icon-control",
  label,
}: {
  seed: string;
  dimmed?: boolean;
  dimension?: AgentIdentityGlyphDimension;
  className?: string;
  label?: string;
}) {
  const identity = buildDelegatedAgentIdentity({
    id: seed,
    title: "Agent",
    sessionId: seed,
  });

  return (
    <AgentIdentityGlyph
      identity={identity}
      closed={dimmed}
      dimension={dimension}
      className={className}
      label={label}
    />
  );
}
