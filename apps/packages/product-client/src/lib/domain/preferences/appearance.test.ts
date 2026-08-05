import { describe, expect, it } from "vitest";
import {
  APPEARANCE_SIZE_IDS,
  DEFAULT_UI_GLYPH_SCALE_CSS_VARIABLES,
  READABLE_CODE_FONT_SCALES,
  resolveAppearanceSizeId,
  resolveWindowZoomId,
  stepAppearanceFontSizes,
  stepAppearanceSizeId,
  stepWindowZoomId,
  UI_FONT_SCALES,
  WINDOW_ZOOM_SCALES,
} from "#product/lib/domain/preferences/appearance";

function cssLengthToPx(value: string): number {
  return Number.parseFloat(value);
}

const UI_FONT_SCALE_SLOTS = Object.keys(
  UI_FONT_SCALES.default,
) as (keyof typeof UI_FONT_SCALES.default)[];

function expectMonotonicTokenScale(token: "fontSize" | "lineHeight") {
  for (let index = 1; index < APPEARANCE_SIZE_IDS.length; index += 1) {
    const previousId = APPEARANCE_SIZE_IDS[index - 1];
    const id = APPEARANCE_SIZE_IDS[index];
    if (!previousId || !id) {
      continue;
    }
    for (const slot of UI_FONT_SCALE_SLOTS) {
      expect(cssLengthToPx(UI_FONT_SCALES[id][slot][token]))
        .toBeGreaterThanOrEqual(cssLengthToPx(UI_FONT_SCALES[previousId][slot][token]));
    }
  }
}

describe("appearance preferences", () => {
  it("resolves invalid size ids to default", () => {
    expect(resolveAppearanceSizeId("xxsmall")).toBe("xxsmall");
    expect(resolveAppearanceSizeId("xxxlarge")).toBe("xxxlarge");
    expect(resolveAppearanceSizeId("unknown")).toBe("default");
    expect(resolveAppearanceSizeId(undefined)).toBe("default");
  });

  it("steps appearance size ids within bounds", () => {
    expect(stepAppearanceSizeId("default", 1)).toBe("large");
    expect(stepAppearanceSizeId("default", -1)).toBe("small");
    expect(stepAppearanceSizeId("xxxlarge", 1)).toBe("xxxlarge");
    expect(stepAppearanceSizeId("xxsmall", -1)).toBe("xxsmall");
  });

  it("resolves and steps window zoom independently", () => {
    expect(resolveWindowZoomId("zoom90")).toBe("zoom90");
    expect(resolveWindowZoomId("unknown")).toBe("default");
    expect(stepWindowZoomId("default", 1)).toBe("zoom110");
    expect(stepWindowZoomId("default", -1)).toBe("zoom90");
    expect(stepWindowZoomId("zoom120", 1)).toBe("zoom120");
    expect(stepWindowZoomId("zoom80", -1)).toBe("zoom80");
    expect(WINDOW_ZOOM_SCALES.default).toEqual({ factor: 1, cssValue: "1" });
  });

  it("steps UI and readable code font sizes independently", () => {
    expect(stepAppearanceFontSizes({
      uiFontSizeId: "xxxlarge",
      readableCodeFontSizeId: "large",
    }, 1)).toEqual({
      uiFontSizeId: "xxxlarge",
      readableCodeFontSizeId: "xlarge",
    });
  });

  it("pins the small and default semantic type scales", () => {
    expect(UI_FONT_SCALES.small).toMatchObject({
      ui: { fontSize: "11px", lineHeight: "16px", letterSpacing: "0.005em" },
      chat: { fontSize: "15px", lineHeight: "23px", letterSpacing: "0" },
      composer: { fontSize: "15px", lineHeight: "23px", letterSpacing: "0" },
      title: { fontSize: "18px", lineHeight: "23px", letterSpacing: "-0.025em" },
    });
    expect(UI_FONT_SCALES.default).toEqual({
      uiSm: { fontSize: "11px", lineHeight: "15px", letterSpacing: "0.01em" },
      ui: { fontSize: "12px", lineHeight: "17px", letterSpacing: "0.005em" },
      chat: { fontSize: "16px", lineHeight: "24px", letterSpacing: "0" },
      composer: { fontSize: "16px", lineHeight: "24px", letterSpacing: "0" },
      body: { fontSize: "13px", lineHeight: "20px", letterSpacing: "0" },
      bodyEmphasis: { fontSize: "14px", lineHeight: "21px", letterSpacing: "-0.005em" },
      workspaceTitle: { fontSize: "14px", lineHeight: "21px", letterSpacing: "-0.005em" },
      heading: { fontSize: "16px", lineHeight: "23px", letterSpacing: "-0.01em" },
      title: { fontSize: "19px", lineHeight: "24px", letterSpacing: "-0.025em" },
      hero: { fontSize: "26px", lineHeight: "34px", letterSpacing: "-0.025em" },
      sidebarNav: { fontSize: "12px", lineHeight: "17px", letterSpacing: "0.005em" },
      sidebarRow: { fontSize: "12px", lineHeight: "17px", letterSpacing: "0.005em" },
      sidebarBrand: { fontSize: "16px", lineHeight: "23px", letterSpacing: "-0.01em" },
    });
  });

  it("declares only the closed semantic type roles", () => {
    expect(Object.keys(UI_FONT_SCALES.default)).toEqual([
      "uiSm",
      "ui",
      "chat",
      "composer",
      "body",
      "bodyEmphasis",
      "workspaceTitle",
      "heading",
      "title",
      "hero",
      "sidebarNav",
      "sidebarRow",
      "sidebarBrand",
    ]);
  });

  it("extends the upper rung instead of duplicating it", () => {
    expect(cssLengthToPx(UI_FONT_SCALES.xxxlarge.ui.fontSize))
      .toBeGreaterThan(cssLengthToPx(UI_FONT_SCALES.xxlarge.ui.fontSize));
    expect(UI_FONT_SCALES.xxxlarge.composer.fontSize).toBe("20px");
    expect(READABLE_CODE_FONT_SCALES.xxxlarge.monacoFontSize).toBe(17);
  });

  it("keeps workspace titles exactly one step above body text at every preset", () => {
    for (const id of APPEARANCE_SIZE_IDS) {
      expect(cssLengthToPx(UI_FONT_SCALES[id].workspaceTitle.fontSize))
        .toBe(cssLengthToPx(UI_FONT_SCALES[id].body.fontSize) + 1);
      expect(cssLengthToPx(UI_FONT_SCALES[id].workspaceTitle.lineHeight))
        .toBe(cssLengthToPx(UI_FONT_SCALES[id].body.lineHeight) + 1);
    }
  });

  it("exposes semantic glyph tiers with the approved paired-icon ratio", () => {
    expect(DEFAULT_UI_GLYPH_SCALE_CSS_VARIABLES).toEqual({
      "--icon-status": "0.55em",
      "--icon-tight": "0.875em",
      "--icon-compact": "1em",
      "--icon-indicator": "1em",
      "--icon-paired": "1.230769em",
      "--icon-control": "1.333333em",
      "--icon-large": "1.666667em",
      "--icon-display": "2em",
    });
  });

  it("keeps readable code aligned with the compact body ramp, independently of chat", () => {
    for (const id of APPEARANCE_SIZE_IDS) {
      const bodyPx = cssLengthToPx(UI_FONT_SCALES[id].body.fontSize);
      const readable = READABLE_CODE_FONT_SCALES[id];
      expect(readable.monacoFontSize).toBe(bodyPx);
      expect(readable.monacoLineHeight).toBe(bodyPx + 8);
      expect(cssLengthToPx(readable.diffsFontSize)).toBe(bodyPx);
      expect(readable.diffsLineHeight).toBe("calc(var(--diffs-font-size) * 1.8)");
      expect(cssLengthToPx(readable.codeFontSize)).toBe(bodyPx);
      expect(readable.codeLineHeight).toBe("1.625");
      expect(cssLengthToPx(UI_FONT_SCALES[id].composer.fontSize)).toBe(bodyPx + 3);
    }
  });

  it("keeps UI and readable-code ladders monotonic and main presets distinct", () => {
    expectMonotonicTokenScale("fontSize");
    expectMonotonicTokenScale("lineHeight");

    for (let index = 1; index < APPEARANCE_SIZE_IDS.length; index += 1) {
      const previousId = APPEARANCE_SIZE_IDS[index - 1];
      const id = APPEARANCE_SIZE_IDS[index];
      if (!previousId || !id) {
        continue;
      }
      expect(READABLE_CODE_FONT_SCALES[id].monacoFontSize)
        .toBeGreaterThanOrEqual(READABLE_CODE_FONT_SCALES[previousId].monacoFontSize);
      expect(READABLE_CODE_FONT_SCALES[id].monacoLineHeight)
        .toBeGreaterThanOrEqual(READABLE_CODE_FONT_SCALES[previousId].monacoLineHeight);
    }

    expect(cssLengthToPx(UI_FONT_SCALES.small.ui.fontSize))
      .toBeLessThan(cssLengthToPx(UI_FONT_SCALES.default.ui.fontSize));
    expect(cssLengthToPx(UI_FONT_SCALES.default.ui.fontSize))
      .toBeLessThan(cssLengthToPx(UI_FONT_SCALES.large.ui.fontSize));
  });

  it("uses the readable chat line-height ladder and preserves a usable lower bound", () => {
    for (const id of APPEARANCE_SIZE_IDS) {
      expect(cssLengthToPx(UI_FONT_SCALES[id].chat.lineHeight))
        .toBe(cssLengthToPx(UI_FONT_SCALES[id].composer.fontSize) + 8);
    }
    expect(UI_FONT_SCALES.xxsmall.uiSm.fontSize).toBe("9px");
    expect(UI_FONT_SCALES.xxsmall.chat.fontSize).toBe("14px");
    expect(UI_FONT_SCALES.xxsmall.chat.lineHeight).toBe("22px");
    expect(READABLE_CODE_FONT_SCALES.xxsmall.monacoFontSize).toBe(11);
  });

  it("keeps every semantic alias on its owning ramp step", () => {
    for (const id of APPEARANCE_SIZE_IDS) {
      expect(UI_FONT_SCALES[id].composer).toEqual(UI_FONT_SCALES[id].chat);
      expect(UI_FONT_SCALES[id].bodyEmphasis).toEqual(UI_FONT_SCALES[id].workspaceTitle);
      expect(UI_FONT_SCALES[id].sidebarNav).toEqual(UI_FONT_SCALES[id].ui);
      expect(UI_FONT_SCALES[id].sidebarRow).toEqual(UI_FONT_SCALES[id].ui);
      expect(UI_FONT_SCALES[id].sidebarBrand).toEqual(UI_FONT_SCALES[id].heading);
    }
  });
});
