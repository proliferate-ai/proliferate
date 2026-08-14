import { solidSealGeometry } from "#product/lib/domain/delegated-work/solid-seal";
import type { DelegatedAgentIdentity } from "#product/lib/domain/delegated-work/model";

export type AgentIdentityGlyphDimension = 12 | 14 | 16 | 18 | 20;

/**
 * Shared UI-R01 Solid Seal renderer for every durable agent-identity surface.
 * Geometry and color come from the session-derived identity; size and Closed
 * opacity are presentation-only and cannot alter that identity.
 */
export function AgentIdentityGlyph({
  identity,
  dimension,
  closed = false,
  className = "",
  label,
}: {
  identity: DelegatedAgentIdentity;
  dimension?: AgentIdentityGlyphDimension;
  closed?: boolean;
  className?: string;
  label?: string;
}) {
  if (!identity.sessionId) {
    return null;
  }

  const geometry = solidSealGeometry(identity.glyphSeedHash);
  const renderedDimension = dimension ?? "1em";

  return (
    <svg
      viewBox="0 0 24 24"
      width={renderedDimension}
      height={renderedDimension}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`shrink-0 ${className}`.trim()}
      style={{
        width: dimension,
        height: dimension,
        color: identity.colorVar,
        opacity: closed ? 0.45 : 1,
      }}
    >
      <g fill="currentColor">
        {geometry.shape === "circle" ? <circle cx={12} cy={12} r={8.6} /> : null}
        {geometry.shape === "squircle" ? (
          <rect x={3.9} y={3.9} width={16.2} height={16.2} rx={6.5} />
        ) : null}
        {geometry.shape === "diamond" ? (
          <polygon points="12,3.2 20.8,12 12,20.8 3.2,12" />
        ) : null}
        {geometry.shape === "rotated-square" ? (
          <rect
            x={4.6}
            y={4.6}
            width={14.8}
            height={14.8}
            rx={4}
            transform="rotate(45 12 12)"
          />
        ) : null}
      </g>
      <circle
        data-solid-seal-notch
        cx={geometry.notchX}
        cy={geometry.notchY}
        r={2.3}
        fill="var(--color-background)"
      />
    </svg>
  );
}
