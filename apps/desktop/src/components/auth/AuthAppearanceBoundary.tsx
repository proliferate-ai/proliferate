import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { DEFAULT_UI_TEXT_SCALE_CSS_VARIABLES } from "@/lib/domain/preferences/appearance";
import { twMerge } from "@proliferate/ui/utils/tw-merge";

const DEFAULT_AUTH_APPEARANCE_STYLE =
  DEFAULT_UI_TEXT_SCALE_CSS_VARIABLES as CSSProperties;

interface AuthAppearanceBoundaryProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function AuthAppearanceBoundary({
  children,
  className,
  style,
  ...props
}: AuthAppearanceBoundaryProps) {
  return (
    <div
      {...props}
      className={twMerge(className)}
      data-auth-default-appearance=""
      style={{
        ...DEFAULT_AUTH_APPEARANCE_STYLE,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
