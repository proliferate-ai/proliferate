import type { ComponentType, CSSProperties, SVGProps } from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";
import {
  Blocks,
  CloudIcon,
  Globe,
  Monitor,
} from "#product/primitives/icons/platform";
import {
  Folder,
  Terminal,
} from "#product/primitives/icons/workspace";
import { Zap } from "#product/primitives/icons/product";
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
  inherit: "size-full rounded-sm text-ui [&_svg]:icon-compact",
  xs: "size-4 rounded-sm text-ui [&_svg]:icon-compact",
  sm: "size-5 rounded-md text-ui [&_svg]:icon-compact",
  md: "size-7 rounded-lg text-ui [&_svg]:icon-control",
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
      <Icon aria-hidden="true" />
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
