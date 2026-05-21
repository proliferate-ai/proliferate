import type { ComputeTargetKind } from "@/lib/domain/compute/target-types";

export const COMPUTE_TARGET_ICON_IDS = [
  "monitor",
  "cloud",
  "bolt",
  "blocks",
  "terminal",
  "globe",
  "folder",
] as const;

export type ComputeTargetIconId = (typeof COMPUTE_TARGET_ICON_IDS)[number];

export const COMPUTE_TARGET_COLOR_IDS = [
  "slate",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
] as const;

export type ComputeTargetColorId = (typeof COMPUTE_TARGET_COLOR_IDS)[number];

export interface ComputeTargetAppearancePreference {
  targetId: string;
  displayName?: string | null;
  iconId: ComputeTargetIconId;
  colorId: ComputeTargetColorId;
}

export interface ComputeTargetAppearance {
  displayName: string;
  iconId: ComputeTargetIconId;
  iconLabel: string;
  colorId: ComputeTargetColorId;
  colorLabel: string;
  colorValue: string;
}

export const COMPUTE_TARGET_ICON_OPTIONS: Array<{
  id: ComputeTargetIconId;
  label: string;
}> = [
  { id: "monitor", label: "Monitor" },
  { id: "cloud", label: "Cloud" },
  { id: "bolt", label: "Lightning" },
  { id: "blocks", label: "Blocks" },
  { id: "terminal", label: "Terminal" },
  { id: "globe", label: "Globe" },
  { id: "folder", label: "Folder" },
];

export const COMPUTE_TARGET_COLOR_OPTIONS: Array<{
  id: ComputeTargetColorId;
  label: string;
  value: string;
}> = [
  { id: "slate", label: "Slate", value: "#6b7280" },
  { id: "red", label: "Red", value: "#b04444" },
  { id: "orange", label: "Orange", value: "#b56b3a" },
  { id: "amber", label: "Amber", value: "#b59a3a" },
  { id: "green", label: "Green", value: "#4a8d5a" },
  { id: "teal", label: "Teal", value: "#3c8a86" },
  { id: "blue", label: "Blue", value: "#4a72b5" },
  { id: "purple", label: "Purple", value: "#7a5ab0" },
  { id: "pink", label: "Pink", value: "#b0567c" },
];

const ICON_OPTIONS_BY_ID = new Map(
  COMPUTE_TARGET_ICON_OPTIONS.map((option) => [option.id, option]),
);
const COLOR_OPTIONS_BY_ID = new Map(
  COMPUTE_TARGET_COLOR_OPTIONS.map((option) => [option.id, option]),
);

function isComputeTargetIconId(value: unknown): value is ComputeTargetIconId {
  return typeof value === "string"
    && COMPUTE_TARGET_ICON_IDS.includes(value as ComputeTargetIconId);
}

function isComputeTargetColorId(value: unknown): value is ComputeTargetColorId {
  return typeof value === "string"
    && COMPUTE_TARGET_COLOR_IDS.includes(value as ComputeTargetColorId);
}

function stableIndex(input: string, length: number): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash % length;
}

export function defaultComputeTargetIconId(kind: ComputeTargetKind): ComputeTargetIconId {
  switch (kind) {
    case "managed_cloud":
    case "self_hosted_cloud":
      return "cloud";
    case "desktop_dispatch":
    case "local_direct":
      return "monitor";
    case "ssh":
      return "monitor";
  }
}

export function defaultComputeTargetColorId(targetId: string): ComputeTargetColorId {
  return COMPUTE_TARGET_COLOR_IDS[stableIndex(targetId, COMPUTE_TARGET_COLOR_IDS.length)]
    ?? "blue";
}

export function normalizeComputeTargetAppearancePreference(
  input: unknown,
): ComputeTargetAppearancePreference | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const record = input as Record<string, unknown>;
  const targetId = typeof record.targetId === "string" ? record.targetId.trim() : "";
  if (!targetId) {
    return null;
  }
  const displayName = typeof record.displayName === "string"
    ? record.displayName.trim()
    : "";
  return {
    targetId,
    displayName: displayName || null,
    iconId: isComputeTargetIconId(record.iconId) ? record.iconId : "monitor",
    colorId: isComputeTargetColorId(record.colorId) ? record.colorId : "blue",
  };
}

export function resolveComputeTargetAppearance(input: {
  targetId: string;
  displayName: string;
  kind: ComputeTargetKind;
  preference?: ComputeTargetAppearancePreference | null;
}): ComputeTargetAppearance {
  const iconId = input.preference?.iconId ?? defaultComputeTargetIconId(input.kind);
  const colorId = input.preference?.colorId ?? defaultComputeTargetColorId(input.targetId);
  const icon = ICON_OPTIONS_BY_ID.get(iconId) ?? ICON_OPTIONS_BY_ID.get("monitor")!;
  const color = COLOR_OPTIONS_BY_ID.get(colorId) ?? COLOR_OPTIONS_BY_ID.get("blue")!;
  const displayName = input.preference?.displayName?.trim() || input.displayName;
  return {
    displayName,
    iconId: icon.id,
    iconLabel: icon.label,
    colorId: color.id,
    colorLabel: color.label,
    colorValue: color.value,
  };
}
