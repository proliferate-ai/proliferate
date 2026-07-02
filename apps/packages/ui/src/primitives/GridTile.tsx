import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

interface GridTileProps {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}

const TILE_CLASS = "block w-full rounded-lg border border-border bg-background p-4 text-left text-foreground";

export function GridTile({ children, onClick, className = "" }: GridTileProps) {
  if (onClick) {
    return (
      <button
        type="button"
        className={twMerge(TILE_CLASS, "cursor-pointer transition-colors hover:bg-accent", className)}
        onClick={onClick}
      >
        {children}
      </button>
    );
  }
  return <div className={twMerge(TILE_CLASS, className)}>{children}</div>;
}
