import type { ComponentType, CSSProperties, SVGProps } from "react";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import {
  Blocks,
  CloudIcon,
  Folder,
  Globe,
  Monitor,
  Terminal,
  Zap,
} from "@proliferate/ui/icons";
import type {
  ComputeTargetAppearance,
  ComputeTargetIconId,
} from "@/lib/domain/compute/target-appearance";

type SwatchSize = "inherit" | "xs" | "sm" | "md";

const ICONS: Record<ComputeTargetIconId, ComponentType<SVGProps<SVGSVGElement>>> = {
  monitor: Monitor,
  cloud: CloudIcon,
  bolt: Zap,
  blocks: Blocks,
  terminal: Terminal,
  globe: Globe,
  folder: Folder,
};

const SIZE_CLASSES: Record<SwatchSize, string> = {
  inherit: "size-full rounded-[0.25em]",
  xs: "size-4 rounded-[4px]",
  sm: "size-7 rounded-md",
  md: "size-8 rounded-lg",
};

const ICON_SIZE_CLASSES: Record<SwatchSize, string> = {
  inherit: "size-[62.5%]",
  xs: "size-2.5",
  sm: "size-4",
  md: "size-4",
};

export function ComputeTargetSwatch({
  appearance,
  size = "md",
  className = "",
}: {
  appearance: Pick<ComputeTargetAppearance, "iconId" | "iconLabel" | "colorValue">;
  size?: SwatchSize;
  className?: string;
}) {
  const Icon = ICONS[appearance.iconId] ?? Monitor;
  const style = {
    "--compute-target-color": appearance.colorValue,
  } as CSSProperties;
  return (
    <span
      aria-label={`${appearance.iconLabel} target`}
      className={twMerge(
        "inline-flex shrink-0 items-center justify-center bg-[var(--compute-target-color)] text-foreground",
        SIZE_CLASSES[size],
        className,
      )}
      style={style}
    >
      <Icon className={ICON_SIZE_CLASSES[size]} aria-hidden="true" />
    </span>
  );
}

export function ComputeTargetIconGlyph({
  iconId,
  className = "size-4",
}: {
  iconId: ComputeTargetIconId;
  className?: string;
}) {
  const Icon = ICONS[iconId] ?? Monitor;
  return <Icon className={className} aria-hidden="true" />;
}
