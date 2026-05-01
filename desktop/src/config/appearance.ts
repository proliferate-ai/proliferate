import {
  APPEARANCE_SIZE_IDS,
  type ReadableCodeFontSizeId,
  type UiFontSizeId,
} from "@/lib/domain/preferences/appearance";

interface AppearanceSizeOption<T extends string> {
  id: T;
  label: string;
  detail: string;
}

const SIZE_LABELS: Record<UiFontSizeId, string> = {
  xsmall: "Extra Small",
  small: "Small",
  default: "Default",
  large: "Large",
  xlarge: "Extra Large",
  xxlarge: "Extra Extra Large",
};

export const UI_FONT_SIZE_OPTIONS: AppearanceSizeOption<UiFontSizeId>[] =
  APPEARANCE_SIZE_IDS.map((id) => ({
    id,
    label: SIZE_LABELS[id],
    detail: id === "default" ? "Current density" : "App and chat text",
  }));

export const READABLE_CODE_FONT_SIZE_OPTIONS: AppearanceSizeOption<ReadableCodeFontSizeId>[] =
  APPEARANCE_SIZE_IDS.map((id) => ({
    id,
    label: SIZE_LABELS[id],
    detail: id === "default" ? "Current code density" : "Editor, diffs, and code blocks",
  }));

export const UI_FONT_SIZE_LABELS: Record<UiFontSizeId, string> = SIZE_LABELS;
export const READABLE_CODE_FONT_SIZE_LABELS: Record<ReadableCodeFontSizeId, string> = SIZE_LABELS;
