import {
  OPEN_TARGET_FALLBACK_ICON,
  OPEN_TARGET_ICON_DEFINITIONS,
} from "@/config/open-targets";
import type { OpenTargetIconId } from "@proliferate/product-client/host/desktop-bridge";

type OpenTargetIconVariant = "inline" | "menu";

export function OpenTargetIcon({
  iconId,
  className,
}: {
  iconId?: OpenTargetIconId;
  className?: string;
  /** Kept for call-site compat; menu icons render bare (no framed wrapper). */
  variant?: OpenTargetIconVariant;
}) {
  const definition = iconId ? OPEN_TARGET_ICON_DEFINITIONS[iconId] : null;
  const Icon = definition?.component ?? OPEN_TARGET_FALLBACK_ICON;
  return <Icon className={className} />;
}
