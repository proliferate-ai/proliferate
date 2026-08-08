import { useId, useMemo } from "react";
import { mixHash } from "#product/lib/domain/delegated-work/identity";
import type { DelegatedAgentIdentity } from "#product/lib/domain/delegated-work/model";

// The "solid seal" glyph (agent-ops ADR §4, locked style 1e): one solid shape —
// circle, squircle, diamond, or rotated square — with a punched notch whose
// position rotates around an inner ring by seed. Shape and notch position come
// from the same avalanche-mixed seed hash the color already uses, so the glyph
// stays deterministic per session without a second seed. The notch is a real
// mask cut-out rather than a background-colored dot, so the punch survives any
// surface the glyph lands on (chips, tabs, tinted rows).
const NOTCH_RING_RADIUS = 4.1;
const NOTCH_RADIUS = 2.3;

function sealGeometry(iconSeedHash: number) {
  const mixed = mixHash(iconSeedHash);
  const angle = (((mixed >>> 2) % 8) * 45 * Math.PI) / 180;
  return {
    shape: mixed & 3,
    notchX: 12 + NOTCH_RING_RADIUS * Math.cos(angle),
    notchY: 12 + NOTCH_RING_RADIUS * Math.sin(angle),
  };
}

function SealShape({ shape }: { shape: number }) {
  switch (shape) {
    case 0:
      return <circle cx={12} cy={12} r={8.6} />;
    case 1:
      return <rect x={3.9} y={3.9} width={16.2} height={16.2} rx={6.5} />;
    case 2:
      return <polygon points="12,3.2 20.8,12 12,20.8 3.2,12" />;
    default:
      return <rect x={4.6} y={4.6} width={14.8} height={14.8} rx={4} transform="rotate(45 12 12)" />;
  }
}

export function DelegatedAgentIdenticon({
  identity,
  className,
}: {
  identity: DelegatedAgentIdentity;
  className?: string;
}) {
  const maskId = useId();
  const { shape, notchX, notchY } = useMemo(
    () => sealGeometry(identity.iconSeedHash),
    [identity.iconSeedHash],
  );
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {/* Mask fills are luminance values (white keeps, black cuts), not
          palette colors — they never render. */}
      <mask id={maskId}>
        <g fill="white">
          <SealShape shape={shape} />
        </g>
        <circle cx={notchX} cy={notchY} r={NOTCH_RADIUS} fill="black" />
      </mask>
      <g mask={`url(#${maskId})`}>
        <SealShape shape={shape} />
      </g>
    </svg>
  );
}
