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
} from "#product/lib/domain/compute/target-appearance";

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

const SWATCH_SIZE_CLASSES: Record<SwatchSize, string> = {
  inherit: "size-full rounded-[0.25em]",
  xs: "icon-paired rounded-[4px]",
  sm: "icon-large rounded-md",
  md: "icon-display rounded-lg",
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
        SWATCH_SIZE_CLASSES[size],
        className,
      )}
      style={style}
    >
      <Icon className="size-[62.5%]" aria-hidden="true" />
    </span>
  );
}

export function ComputeTargetIconGlyph({
  iconId,
  className = "icon-paired",
}: {
  iconId: ComputeTargetIconId;
  className?: string;
}) {
  const Icon = ICONS[iconId] ?? Monitor;
  return <Icon className={className} aria-hidden="true" />;
}
