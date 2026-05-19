import Svg, { Rect } from "react-native-svg";

import { colors } from "../../styles/tokens";

interface MobileProliferateMarkProps {
  size?: number;
  color?: string;
}

const nodes = [
  { x: 375, y: 375, size: 50 },
  { x: 387.67, y: 305, size: 24.67 },
  { x: 429, y: 346.33, size: 24.67 },
  { x: 470.33, y: 387.67, size: 24.67 },
  { x: 429, y: 429, size: 24.67 },
  { x: 387.67, y: 470.33, size: 24.67 },
  { x: 346.33, y: 429, size: 24.67 },
  { x: 305, y: 387.67, size: 24.67 },
  { x: 346.33, y: 346.33, size: 24.67 },
];

export function MobileProliferateMark({
  size = 24,
  color = colors.fg,
}: MobileProliferateMarkProps) {
  return (
    <Svg viewBox="300 300 200 200" width={size} height={size} fill="none">
      {nodes.map((node, index) => (
        <Rect
          key={`proliferate-mark-${index}`}
          x={node.x}
          y={node.y}
          width={node.size}
          height={node.size}
          fill={color}
        />
      ))}
    </Svg>
  );
}
