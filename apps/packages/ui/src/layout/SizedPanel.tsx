import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

interface SizedPanelProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "style"> {
  children: ReactNode;
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
}

export function SizedPanel({
  children,
  className = "",
  height,
  width,
  ...props
}: SizedPanelProps) {
  const style = width === undefined && height === undefined
    ? undefined
    : { width, height };

  return (
    <div className={className} style={style} {...props}>
      {children}
    </div>
  );
}
