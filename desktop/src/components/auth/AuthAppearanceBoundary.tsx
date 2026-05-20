import type { HTMLAttributes, ReactNode } from "react";
import { twMerge } from "tailwind-merge";

const DEFAULT_APPEARANCE_TEXT_SCALE_CLASS = [
  "[--text-xs:0.5rem]",
  "[--text-xs--line-height:0.75rem]",
  "[--text-sm:0.625rem]",
  "[--text-sm--line-height:1rem]",
  "[--text-base:0.6875rem]",
  "[--text-base--line-height:1rem]",
  "[--text-chat:12px]",
  "[--text-chat--line-height:20px]",
  "[--text-lg:0.875rem]",
  "[--text-lg--line-height:1.25rem]",
  "[--text-xl:1.125rem]",
  "[--text-xl--line-height:1.75rem]",
].join(" ");

interface AuthAppearanceBoundaryProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function AuthAppearanceBoundary({
  children,
  className,
  ...props
}: AuthAppearanceBoundaryProps) {
  return (
    <div
      {...props}
      className={twMerge(DEFAULT_APPEARANCE_TEXT_SCALE_CLASS, className)}
      data-auth-default-appearance=""
    >
      {children}
    </div>
  );
}
