import type { HTMLAttributes, ReactNode } from "react";
import { twMerge } from "tailwind-merge";

export type ComposerTextareaFrameTopInset = "standard" | "none";

interface ComposerTextareaFrameProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  topInset: ComposerTextareaFrameTopInset;
}

export function ComposerTextareaFrame({
  children,
  topInset,
  className = "",
  ...props
}: ComposerTextareaFrameProps) {
  return (
    <div
      {...props}
      className={twMerge(
        "mb-1 flex-grow select-text px-4",
        topInset === "standard" ? "pt-3" : "",
        className,
      )}
    >
      {children}
    </div>
  );
}
