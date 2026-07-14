import type { ReactNode } from "react";
import {
  OPEN_TARGET_FALLBACK_ICON,
  OPEN_TARGET_ICON_DEFINITIONS,
} from "@/config/open-targets";
import type { OpenTargetIconId } from "@proliferate/product-client/host/desktop-bridge";

type OpenTargetIconVariant = "inline" | "menu";

export function AppIconWrapper({ children }: { children: ReactNode }) {
  return (
    <div className="relative size-3.5 rounded">
      {children}
      <div
        className="pointer-events-none absolute inset-0 rounded border border-border mix-blend-darken dark:mix-blend-lighten"
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
