import { type HTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

export function ListSurface({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={twMerge("overflow-hidden rounded-lg border border-border bg-card", className)}
      {...props}
    />
  );
}
