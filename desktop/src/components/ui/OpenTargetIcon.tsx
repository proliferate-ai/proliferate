import type { ReactNode } from "react";
import {
  OPEN_TARGET_FALLBACK_ICON,
  OPEN_TARGET_ICON_DEFINITIONS,
} from "@/config/open-targets";
import type { OpenTargetIconId } from "@/lib/domain/open-targets/model";

type OpenTargetIconVariant = "inline" | "menu";

export function AppIconWrapper({ children }: { children: ReactNode }) {
  return (
    <div className="relative size-3.5 rounded">
      {children}
      {/* Theme mode is stored on data-mode; Tailwind's dark: selector is not used here. */}
      <div
        className="pointer-events-none absolute inset-0 rounded border border-border mix-blend-darken [html[data-mode=dark]_&]:mix-blend-lighten"
      />
    </div>
  );
}

export function OpenTargetIcon({
  iconId,
  className,
  variant = "inline",
}: {
  iconId?: OpenTargetIconId;
  className?: string;
  variant?: OpenTargetIconVariant;
}) {
  const definition = iconId ? OPEN_TARGET_ICON_DEFINITIONS[iconId] : null;
  const Icon = definition?.component ?? OPEN_TARGET_FALLBACK_ICON;
  const icon = <Icon className={className} />;

  if (variant === "menu" && definition?.wrapInMenu) {
    return <AppIconWrapper>{icon}</AppIconWrapper>;
  }

  return icon;
}
