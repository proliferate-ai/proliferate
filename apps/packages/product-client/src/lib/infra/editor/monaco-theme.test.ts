import { codeColors } from "@proliferate/design/tokens";
import { describe, expect, it } from "vitest";
import * as monacoThemes from "#product/lib/infra/editor/monaco-theme";
import {
  proliferateDarkTheme,
  proliferateLightTheme,
  THEME_NAME_DARK,
  THEME_NAME_LIGHT,
} from "#product/lib/infra/editor/monaco-theme";

const DARK_RULE_TOKENS = [
  "comment",
  "keyword",
  "keyword.control",
  "storage",
  "storage.type",
  "string",
  "string.key.json",
  "number",
  "constant",
  "type",
  "type.identifier",
  "entity.name.type",
  "entity.name.function",
  "variable",
  "variable.predefined",
  "delimiter",
  "delimiter.bracket",
  "operator",
  "tag",
  "attribute.name",
  "attribute.value",
  "metatag",
] as const;

const DARK_COLOR_KEYS = [
  "editor.background",
  "editor.foreground",
  "editor.lineHighlightBackground",
  "editor.lineHighlightBorder",
  "editor.selectionBackground",
  "editor.inactiveSelectionBackground",
  "editor.selectionHighlightBackground",
  "editor.findMatchBackground",
  "editor.findMatchHighlightBackground",
  "editorCursor.foreground",
  "editorLineNumber.foreground",
  "editorLineNumber.activeForeground",
  "editorGutter.background",
  "editorIndentGuide.background",
  "editorIndentGuide.activeBackground",
  "editorBracketMatch.background",
  "editorBracketMatch.border",
  "scrollbarSlider.background",
  "scrollbarSlider.hoverBackground",
  "scrollbarSlider.activeBackground",
  "editorWidget.background",
  "editorWidget.border",
  "editorSuggestWidget.background",
  "editorSuggestWidget.selectedBackground",
  "editorSuggestWidget.highlightForeground",
  "minimapSlider.background",
] as const;

const LIGHT_COLOR_KEYS = [
  "editorLineNumber.foreground",
  "editorLineNumber.activeForeground",
  "editor.lineHighlightBackground",
  "editor.lineHighlightBorder",
  "editorGutter.background",
  "editorIndentGuide.background",
  "editorIndentGuide.activeBackground",
  "scrollbarSlider.background",
  "scrollbarSlider.hoverBackground",
  "scrollbarSlider.activeBackground",
] as const;

function withoutHash(color: string): string {
  return color.startsWith("#") ? color.slice(1) : color;
}

describe("Monaco theme exports", () => {
  it("retains the exact runtime export surface and names", () => {
    expect(Object.keys(monacoThemes).sort()).toEqual([
      "THEME_NAME_DARK",
      "THEME_NAME_LIGHT",
      "proliferateDarkTheme",
      "proliferateLightTheme",
    ]);
    expect(THEME_NAME_DARK).toBe("proliferate-dark");
    expect(THEME_NAME_LIGHT).toBe("proliferate-light");
  });

  it("retains the exact base, inheritance, and syntax-rule shapes", () => {
    expect(proliferateDarkTheme.base).toBe("vs-dark");
    expect(proliferateDarkTheme.inherit).toBe(true);
    expect(proliferateDarkTheme.rules.map((rule) => rule.token)).toEqual(DARK_RULE_TOKENS);
    expect(proliferateDarkTheme.rules.map((rule) => rule.fontStyle)).toEqual([
      "italic",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);

    expect(proliferateLightTheme).toMatchObject({
      base: "vs",
      inherit: true,
      rules: [],
    });
  });

  it("retains the exact editor-color key shapes", () => {
    expect(Object.keys(proliferateDarkTheme.colors)).toEqual(DARK_COLOR_KEYS);
    expect(Object.keys(proliferateLightTheme.colors)).toEqual(LIGHT_COLOR_KEYS);
  });

  it("derives syntax and editor colors from the design code palette", () => {
    const allowedDarkRules = new Set(
      Object.values(codeColors.dark).map(withoutHash),
    );
    const allowedDarkColors = new Set([
      ...Object.values(codeColors.dark),
      "transparent",
    ]);
    const allowedLightColors = new Set([
      ...Object.values(codeColors.light),
      "transparent",
    ]);

    for (const rule of proliferateDarkTheme.rules) {
      expect(rule.foreground).toBeDefined();
      expect(allowedDarkRules.has(rule.foreground as string)).toBe(true);
    }
    for (const color of Object.values(proliferateDarkTheme.colors)) {
      expect(allowedDarkColors.has(color)).toBe(true);
    }
    for (const color of Object.values(proliferateLightTheme.colors)) {
      expect(allowedLightColors.has(color)).toBe(true);
    }

    expect(proliferateDarkTheme.colors).toMatchObject({
      "editor.background": codeColors.dark.background,
      "editor.foreground": codeColors.dark.foreground,
      "editor.selectionBackground": codeColors.dark.selection,
      "editor.lineHighlightBackground": codeColors.dark.selection,
    });
    expect(proliferateLightTheme.colors).toMatchObject({
      "editorGutter.background": codeColors.light.background,
      "editor.lineHighlightBackground": codeColors.light.selection,
    });
  });
});
