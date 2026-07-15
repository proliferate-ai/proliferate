import { delegatedWorkVisualIdentity } from "@/lib/domain/delegated-work/identity";

/**
 * Deterministic compact geometric identity mark for a subagent, keyed by the
 * subagent ID. Color reuses the delegated-agent token assignment so the glyph
 * always agrees with tab bubbles and receipt name tinting; the geometry
 * (outer frame, inner motif, rotation, orbit dots) is derived from independent
 * bit ranges of the same seed hash so nearby IDs diverge visually.
 */

interface GlyphGeometry {
  outer: "circle" | "square" | "hexagon" | "octagon";
  inner: "diamond" | "dot" | "bars" | "triangle";
  rotation: number;
  orbitCount: number;
  orbitPhase: number;
}

const OUTER_SHAPES: GlyphGeometry["outer"][] = ["circle", "square", "hexagon", "octagon"];
const INNER_MOTIFS: GlyphGeometry["inner"][] = ["diamond", "dot", "bars", "triangle"];

export function subagentGlyphGeometry(seed: string): GlyphGeometry {
  const hash = mixHash(stableHash(seed));
  return {
    outer: OUTER_SHAPES[hash & 3] ?? "circle",
    inner: INNER_MOTIFS[(hash >>> 2) & 3] ?? "diamond",
    rotation: ((hash >>> 4) & 3) * 45,
    orbitCount: (hash >>> 6) & 3,
    orbitPhase: ((hash >>> 8) % 12) * 30,
  };
}

const HEXAGON_POINTS = "21,12 16.5,19.79 7.5,19.79 3,12 7.5,4.21 16.5,4.21";
const OCTAGON_POINTS =
  "20.69,8.4 20.69,15.6 15.6,20.69 8.4,20.69 3.31,15.6 3.31,8.4 8.4,3.31 15.6,3.31";

export function SubagentIdentityGlyph({
  seed,
  size = 20,
  dimmed = false,
  className = "",
  label,
}: {
  seed: string;
  size?: number;
  dimmed?: boolean;
  className?: string;
  label?: string;
}) {
  const visual = delegatedWorkVisualIdentity(seed);
  const geometry = subagentGlyphGeometry(seed);
  const shapeOpacity = dimmed ? 0.45 : 1;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`shrink-0 ${visual.textColorClassName} ${className}`.trim()}
    >
      <g opacity={shapeOpacity}>
        <g stroke="currentColor" strokeWidth={1.5} fill="currentColor" fillOpacity={0.14}>
          {geometry.outer === "circle" && <circle cx={12} cy={12} r={9} />}
          {geometry.outer === "square" && (
            <rect x={3.5} y={3.5} width={17} height={17} rx={4.5} />
          )}
          {geometry.outer === "hexagon" && <polygon points={HEXAGON_POINTS} />}
          {geometry.outer === "octagon" && <polygon points={OCTAGON_POINTS} />}
        </g>
        <g fill="currentColor" transform={`rotate(${geometry.rotation} 12 12)`}>
          {geometry.inner === "diamond" && (
            <polygon points="12,7.2 16.8,12 12,16.8 7.2,12" />
          )}
          {geometry.inner === "dot" && <circle cx={12} cy={12} r={3.1} />}
          {geometry.inner === "bars" && (
            <>
              <rect x={8.9} y={8} width={2.3} height={8} rx={1.1} />
              <rect x={12.8} y={8} width={2.3} height={8} rx={1.1} />
            </>
          )}
          {geometry.inner === "triangle" && (
            <polygon points="12,7.4 16.2,15.2 7.8,15.2" />
          )}
        </g>
        <g fill="currentColor" fillOpacity={0.75}>
          {Array.from({ length: geometry.orbitCount }, (_, index) => {
            const angle = ((geometry.orbitPhase + index * 120) * Math.PI) / 180;
            return (
              <circle
                key={index}
                cx={round(12 + 6.6 * Math.cos(angle))}
                cy={round(12 + 6.6 * Math.sin(angle))}
                r={1.1}
              />
            );
          })}
        </g>
      </g>
    </svg>
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

// Same avalanche mix used by the delegated-work color assignment: geometry
// consumes different bit ranges than the name/color indices, so glyph shape
// stays decorrelated from glyph color across sequential IDs.
function mixHash(hash: number): number {
  let value = hash >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}
