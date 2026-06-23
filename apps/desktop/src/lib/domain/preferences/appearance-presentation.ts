import {
  APPEARANCE_SIZE_IDS,
  type ReadableCodeFontSizeId,
  type UiFontSizeId,
  type WindowZoomId,
  WINDOW_ZOOM_IDS,
} from "@/lib/domain/preferences/appearance";

interface AppearanceSizeOption<T extends string> {
  id: T;
  label: string;
  detail: string;
}

const SIZE_LABELS: Record<UiFontSizeId, string> = {
  xxsmall: "Smallest",
  xsmall: "Extra Small",
  small: "Small",
  default: "Default",
  large: "Large",
  xlarge: "Extra Large",
  xxlarge: "Extra Extra Large",
  xxxlarge: "Largest",
};

const WINDOW_ZOOM_LABELS_INTERNAL: Record<WindowZoomId, string> = {
  zoom80: "80%",
  zoom90: "90%",
  default: "100%",
  zoom110: "110%",
  zoom120: "120%",
};

export const UI_FONT_SIZE_OPTIONS: AppearanceSizeOption<UiFontSizeId>[] =
  APPEARANCE_SIZE_IDS.map((id) => ({
    id,
    label: SIZE_LABELS[id],
    detail: id === "default" ? "Default app and chat text" : "App and chat text",
  }));

export const READABLE_CODE_FONT_SIZE_OPTIONS: AppearanceSizeOption<ReadableCodeFontSizeId>[] =
  APPEARANCE_SIZE_IDS.map((id) => ({
    id,
    label: SIZE_LABELS[id],
    detail: id === "default" ? "Default editor and code text" : "Editor, diffs, and code blocks",
  }));

export const WINDOW_ZOOM_OPTIONS: AppearanceSizeOption<WindowZoomId>[] =
  WINDOW_ZOOM_IDS.map((id) => ({
    id,
    label: WINDOW_ZOOM_LABELS_INTERNAL[id],
    detail: id === "default" ? "Default app zoom" : "App window zoom",
  }));

export const UI_FONT_SIZE_LABELS: Record<UiFontSizeId, string> = SIZE_LABELS;
export const READABLE_CODE_FONT_SIZE_LABELS: Record<ReadableCodeFontSizeId, string> = SIZE_LABELS;
export const WINDOW_ZOOM_LABELS: Record<WindowZoomId, string> = WINDOW_ZOOM_LABELS_INTERNAL;
