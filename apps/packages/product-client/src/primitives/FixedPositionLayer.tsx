import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

type FixedPosition = Partial<Pick<CSSProperties, "top" | "right" | "bottom" | "left">>;

interface FixedPositionLayerProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "style"> {
  children: ReactNode;
  position: FixedPosition;
}

export function FixedPositionLayer({
  children,
  className = "",
  position,
  ...props
}: FixedPositionLayerProps) {
  return (
    <div className={className} style={position} {...props}>
      {children}
    </div>
  );
}
