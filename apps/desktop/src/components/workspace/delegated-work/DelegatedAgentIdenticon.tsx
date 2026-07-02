import { useMemo } from "react";
import { delegatedAgentIdenticonCells } from "@/lib/domain/delegated-work/identicon";
import type { DelegatedAgentIdentity } from "@/lib/domain/delegated-work/model";

// Cell layout inside the 24-unit viewBox: 5 cells on a 4.5-unit pitch with a
// 1-unit gap, padded so cells never touch the edge. The gap has to stay
// visible at 12-16px render sizes or the grid reads as a blob instead of
// pixels; the corner radius stays subtle for the same reason.
const CELL_PITCH = 4.5;
const CELL_SIZE = 3.5;
const CELL_RADIUS = 0.6;
const GRID_PADDING = (24 - (4 * CELL_PITCH + CELL_SIZE)) / 2;

export function DelegatedAgentIdenticon({
  identity,
  className,
}: {
  identity: DelegatedAgentIdentity;
  className?: string;
}) {
  const cells = useMemo(
    () => delegatedAgentIdenticonCells(identity.iconSeedHash),
    [identity.iconSeedHash],
  );
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {cells.flatMap((row, rowIndex) =>
        row.map((lit, columnIndex) =>
          lit ? (
            <rect
              key={`${rowIndex}-${columnIndex}`}
              x={GRID_PADDING + columnIndex * CELL_PITCH}
              y={GRID_PADDING + rowIndex * CELL_PITCH}
              width={CELL_SIZE}
              height={CELL_SIZE}
              rx={CELL_RADIUS}
            />
          ) : null,
        ),
      )}
    </svg>
  );
}
