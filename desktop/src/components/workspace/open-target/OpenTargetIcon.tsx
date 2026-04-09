import type { ReactNode } from "react";
import {
  OPEN_TARGET_FALLBACK_ICON,
  OPEN_TARGET_ICON_DEFINITIONS,
} from "@/config/open-targets";
import type { OpenTargetIconId } from "@/platform/tauri/shell";

type OpenTargetIconVariant = "inline" | "menu";

export function AppIconWrapper({ children }: { children: ReactNode }) {
  return (
    <div className="size-3.5 relative rounded">
      {children}
      <div
        className="absolute inset-0 rounded border border-border pointer-events-none mix-blend-darken dark:mix-blend-lighten"
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
