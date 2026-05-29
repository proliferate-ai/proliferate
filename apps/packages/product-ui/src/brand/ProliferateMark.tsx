import { type SVGProps } from "react";

type ProliferateNode = { x: number; y: number; size: number };

const PROLIFERATE_VIEW_BOX = "300 300 200 200";
const PROLIFERATE_CENTER_NODE: ProliferateNode = { x: 375, y: 375, size: 50 };
const PROLIFERATE_ORBIT_NODES: ProliferateNode[] = [
  { x: 387.67, y: 305, size: 24.67 },
  { x: 429, y: 346.33, size: 24.67 },
  { x: 470.33, y: 387.67, size: 24.67 },
  { x: 429, y: 429, size: 24.67 },
  { x: 387.67, y: 470.33, size: 24.67 },
  { x: 346.33, y: 429, size: 24.67 },
  { x: 305, y: 387.67, size: 24.67 },
  { x: 346.33, y: 346.33, size: 24.67 },
];

interface ProliferateMarkProps extends Omit<SVGProps<SVGSVGElement>, "height" | "width"> {
  size?: number;
}

export function ProliferateMark({
  size = 18,
  className,
  ...props
}: ProliferateMarkProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      shapeRendering="crispEdges"
      viewBox={PROLIFERATE_VIEW_BOX}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {[PROLIFERATE_CENTER_NODE, ...PROLIFERATE_ORBIT_NODES].map((node, index) => (
        <rect
          key={`proliferate-node-${index}`}
          x={node.x}
          y={node.y}
          width={node.size}
          height={node.size}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}
