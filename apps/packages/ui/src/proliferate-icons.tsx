import type { IconProps } from "./icons/types";

type ProliferateNode = { x: number; y: number; size: number };

const PROLIFERATE_VIEW_BOX = "300 300 200 200";
const PROLIFERATE_CENTER_NODE: ProliferateNode = { x: 375, y: 375, size: 50 };
const PROLIFERATE_CENTER_NODE_SMALL: ProliferateNode = { x: 387, y: 387, size: 26 };
const PROLIFERATE_INNER_NODES: ProliferateNode[] = [
  { x: 392, y: 350.67, size: 16 },  // top
  { x: 433.33, y: 392, size: 16 },  // right
  { x: 392, y: 433.33, size: 16 },  // bottom
  { x: 350.67, y: 392, size: 16 },  // left
];
const PROLIFERATE_ORBIT_NODES = [
  { x: 387.67, y: 305, size: 24.67 },
  { x: 429, y: 346.33, size: 24.67 },
  { x: 470.33, y: 387.67, size: 24.67 },
  { x: 429, y: 429, size: 24.67 },
  { x: 387.67, y: 470.33, size: 24.67 },
  { x: 346.33, y: 429, size: 24.67 },
  { x: 305, y: 387.67, size: 24.67 },
  { x: 346.33, y: 346.33, size: 24.67 },
];
const PROLIFERATE_ORBIT_DELAY_CLASSES = [
  "[animation-delay:0s]",
  "[animation-delay:0.2s]",
  "[animation-delay:0.4s]",
  "[animation-delay:0.6s]",
  "[animation-delay:0.8s]",
  "[animation-delay:1s]",
  "[animation-delay:1.2s]",
  "[animation-delay:1.4s]",
] as const;

function renderProliferateNode(node: ProliferateNode, key: string, className?: string) {
  return (
    <rect
      key={key}
      x={node.x}
      y={node.y}
      width={node.size}
      height={node.size}
      fill="currentColor"
      className={className}
    />
  );
}

function ProliferateMark({
  className,
  nodes,
  ...props
}: IconProps & {
  nodes: ProliferateNode[];
}) {
  return (
    <svg
      className={className}
      viewBox={PROLIFERATE_VIEW_BOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="crispEdges"
      {...props}
    >
      {nodes.map((node, index) => renderProliferateNode(node, `node-${index}`))}
    </svg>
  );
}



/** Proliferate icon — Full mark */
export function ProliferateIcon({ className, ...props }: IconProps) {
  return (
    <ProliferateMark
      className={className}
      nodes={[PROLIFERATE_CENTER_NODE, ...PROLIFERATE_ORBIT_NODES]}
      {...props}
    />
  );
}



export function ProliferateIconLoading({ className }: { className?: string }) {
  return <ProliferateIcon className={className} />;
}

/**
 * Snake — one orbit node fades in per time step, stays lit for a few steps,
 * then fades out. ~3 nodes visible at any moment, sliding around the orbit.
 * Center stays at a steady low opacity as an anchor.
 */
/**
 * Renders all 13 snake nodes (8 outer + 4 inner + center) with a given
 * step order. `order` maps each step index to { layer, nodeIndex }.
 */
type SnakeStep = { layer: "outer" | "inner" | "center"; idx: number };

function ProliferateSnakeMark({
  className,
  snakePath,
}: { className?: string; snakePath: SnakeStep[] }) {
  // Build a map from (layer+idx) → animation step
  const stepMap = new Map<string, number>();
  snakePath.forEach((entry, step) => stepMap.set(`${entry.layer}-${entry.idx}`, step));

  const cls = (layer: string, idx: number) =>
    `animate-snake-${stepMap.get(`${layer}-${idx}`) ?? 0}`;

  return (
    <svg
      className={className}
      viewBox={PROLIFERATE_VIEW_BOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="crispEdges"
    >
      {PROLIFERATE_ORBIT_NODES.map((node, i) =>
        renderProliferateNode(node, `snake-o${i}`, cls("outer", i))
      )}
      {PROLIFERATE_INNER_NODES.map((node, i) =>
        renderProliferateNode(node, `snake-i${i}`, cls("inner", i))
      )}
      {renderProliferateNode(PROLIFERATE_CENTER_NODE_SMALL, "snake-c", cls("center", 0))}
    </svg>
  );
}

// Path A — Spiral inward: outer CW → inner CW → center
const SNAKE_PATH_SPIRAL_IN = [
  { layer: "outer" as const, idx: 0 }, { layer: "outer" as const, idx: 1 },
  { layer: "outer" as const, idx: 2 }, { layer: "outer" as const, idx: 3 },
  { layer: "outer" as const, idx: 4 }, { layer: "outer" as const, idx: 5 },
  { layer: "outer" as const, idx: 6 }, { layer: "outer" as const, idx: 7 },
  { layer: "inner" as const, idx: 0 }, { layer: "inner" as const, idx: 1 },
  { layer: "inner" as const, idx: 2 }, { layer: "inner" as const, idx: 3 },
  { layer: "center" as const, idx: 0 },
];

// Path B — Spiral outward: center → inner CW → outer CW
const SNAKE_PATH_SPIRAL_OUT = [
  { layer: "center" as const, idx: 0 },
  { layer: "inner" as const, idx: 0 }, { layer: "inner" as const, idx: 1 },
  { layer: "inner" as const, idx: 2 }, { layer: "inner" as const, idx: 3 },
  { layer: "outer" as const, idx: 0 }, { layer: "outer" as const, idx: 1 },
  { layer: "outer" as const, idx: 2 }, { layer: "outer" as const, idx: 3 },
  { layer: "outer" as const, idx: 4 }, { layer: "outer" as const, idx: 5 },
  { layer: "outer" as const, idx: 6 }, { layer: "outer" as const, idx: 7 },
];

// Path C — Radial spokes: each cardinal outer+inner pair, then diagonals, then center
// top(o0,i0) → right(o2,i1) → bottom(o4,i2) → left(o6,i3) → diagonals → center
const SNAKE_PATH_SPOKES = [
  { layer: "outer" as const, idx: 0 }, { layer: "inner" as const, idx: 0 },
  { layer: "outer" as const, idx: 2 }, { layer: "inner" as const, idx: 1 },
  { layer: "outer" as const, idx: 4 }, { layer: "inner" as const, idx: 2 },
  { layer: "outer" as const, idx: 6 }, { layer: "inner" as const, idx: 3 },
  { layer: "outer" as const, idx: 1 }, { layer: "outer" as const, idx: 3 },
  { layer: "outer" as const, idx: 5 }, { layer: "outer" as const, idx: 7 },
  { layer: "center" as const, idx: 0 },
];

// Path D — Bounce: opposite outer pairs, then opposite inner, then center
const SNAKE_PATH_BOUNCE = [
  { layer: "outer" as const, idx: 0 }, { layer: "outer" as const, idx: 4 },
  { layer: "outer" as const, idx: 2 }, { layer: "outer" as const, idx: 6 },
  { layer: "outer" as const, idx: 1 }, { layer: "outer" as const, idx: 5 },
  { layer: "outer" as const, idx: 3 }, { layer: "outer" as const, idx: 7 },
  { layer: "inner" as const, idx: 0 }, { layer: "inner" as const, idx: 2 },
  { layer: "inner" as const, idx: 1 }, { layer: "inner" as const, idx: 3 },
  { layer: "center" as const, idx: 0 },
];

/** A — Spiral inward */
export function ProliferateIconSnakeSpiralIn(props: IconProps) {
  return <ProliferateSnakeMark {...props} snakePath={SNAKE_PATH_SPIRAL_IN} />;
}
/** B — Spiral outward */
export function ProliferateIconSnakeSpiralOut(props: IconProps) {
  return <ProliferateSnakeMark {...props} snakePath={SNAKE_PATH_SPIRAL_OUT} />;
}
/** C — Radial spokes */
export function ProliferateIconSnakeSpokes(props: IconProps) {
  return <ProliferateSnakeMark {...props} snakePath={SNAKE_PATH_SPOKES} />;
}
/** D — Bounce (opposites) */
export function ProliferateIconSnakeBounce(props: IconProps) {
  return <ProliferateSnakeMark {...props} snakePath={SNAKE_PATH_BOUNCE} />;
}

/** @deprecated use named snake variants */
export const ProliferateIconAssemble = ProliferateIconSnakeSpiralIn;

export const BlockIcon = ProliferateIcon;

export function RippleLogo({ className, ...props }: IconProps) {
  return (
    <svg
      className={className}
      viewBox={PROLIFERATE_VIEW_BOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="crispEdges"
      {...props}
    >
      {renderProliferateNode(
        PROLIFERATE_CENTER_NODE,
        "center",
        "animate-ripple-center",
      )}
      {PROLIFERATE_ORBIT_NODES.map((node, index) =>
        renderProliferateNode(
          node,
          `orbit-${index}`,
          `animate-ripple-sat ${PROLIFERATE_ORBIT_DELAY_CLASSES[index]}`,
        ),
      )}
    </svg>
  );
}
