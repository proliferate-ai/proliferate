/**
 * Custom Monaco theme matched to the Proliferate ship palette.
 * Extends vs-dark, overrides editor chrome + key syntax token colors.
 *
 * Every color resolves from the design code-palette authority
 * (`apps/packages/design/src/tokens.ts` → `codeColors`); the former warm
 * `#1A1715` / `#D4A574` world is retired. Token and editor-color shapes are
 * unchanged, so this stays a drop-in for monaco.editor.defineTheme.
 *
 * The data type matches monaco.editor.IStandaloneThemeData — inlined to avoid
 * a direct monaco-editor import (types live inside the pnpm store).
 */

import { codeColors } from "@proliferate/design/tokens";

type MonacoThemeData = {
  base: "vs" | "vs-dark" | "hc-black";
  inherit: boolean;
  rules: Array<{
    token: string;
    foreground?: string;
    background?: string;
    fontStyle?: string;
  }>;
  colors: Record<string, string>;
};

/**
 * Monaco's TextMate-style `rules` take bare six-digit RGB — no leading `#` and
 * no alpha pair (an 8-digit value there is silently dropped). Editor `colors`
 * keep the full `#RRGGBB[AA]` form, so only rule colors go through this.
 */
function monacoRuleHex(color: string): string {
  const hex = color.startsWith("#") ? color.slice(1) : color;
  return hex.length > 6 ? hex.slice(0, 6) : hex;
}

export const proliferateDarkTheme: MonacoThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: monacoRuleHex(codeColors.dark.muted), fontStyle: "italic" },
    { token: "keyword", foreground: monacoRuleHex(codeColors.dark.keyword) },
    { token: "keyword.control", foreground: monacoRuleHex(codeColors.dark.keyword) },
    { token: "storage", foreground: monacoRuleHex(codeColors.dark.keyword) },
    { token: "storage.type", foreground: monacoRuleHex(codeColors.dark.keyword) },
    { token: "string", foreground: monacoRuleHex(codeColors.dark.string) },
    { token: "string.key.json", foreground: monacoRuleHex(codeColors.dark.emphasis) },
    { token: "number", foreground: monacoRuleHex(codeColors.dark.emphasis) },
    { token: "constant", foreground: monacoRuleHex(codeColors.dark.emphasis) },
    { token: "type", foreground: monacoRuleHex(codeColors.dark.support) },
    { token: "type.identifier", foreground: monacoRuleHex(codeColors.dark.support) },
    { token: "entity.name.type", foreground: monacoRuleHex(codeColors.dark.support) },
    { token: "entity.name.function", foreground: monacoRuleHex(codeColors.dark.heading) },
    { token: "variable", foreground: monacoRuleHex(codeColors.dark.foreground) },
    { token: "variable.predefined", foreground: monacoRuleHex(codeColors.dark.support) },
    { token: "delimiter", foreground: monacoRuleHex(codeColors.dark.muted) },
    { token: "delimiter.bracket", foreground: monacoRuleHex(codeColors.dark.muted) },
    { token: "operator", foreground: monacoRuleHex(codeColors.dark.muted) },
    { token: "tag", foreground: monacoRuleHex(codeColors.dark.string) },
    { token: "attribute.name", foreground: monacoRuleHex(codeColors.dark.emphasis) },
    { token: "attribute.value", foreground: monacoRuleHex(codeColors.dark.string) },
    { token: "metatag", foreground: monacoRuleHex(codeColors.dark.string) },
  ],
  colors: {
    "editor.background": codeColors.dark.background,
    "editor.foreground": codeColors.dark.foreground,
    "editor.lineHighlightBackground": codeColors.dark.selection,
    "editor.lineHighlightBorder": "transparent",
    "editor.selectionBackground": codeColors.dark.selection,
    "editor.inactiveSelectionBackground": codeColors.dark.selection,
    "editor.selectionHighlightBackground": codeColors.dark.selection,
    "editor.findMatchBackground": codeColors.dark.selection,
    "editor.findMatchHighlightBackground": codeColors.dark.selection,
    "editorCursor.foreground": codeColors.dark.foreground,
    "editorLineNumber.foreground": codeColors.dark.muted,
    "editorLineNumber.activeForeground": codeColors.dark.foreground,
    "editorGutter.background": codeColors.dark.background,
    "editorIndentGuide.background": codeColors.dark.selection,
    "editorIndentGuide.activeBackground": codeColors.dark.selection,
    "editorBracketMatch.background": codeColors.dark.selection,
    "editorBracketMatch.border": codeColors.dark.keyword,
    "scrollbarSlider.background": codeColors.dark.selection,
    "scrollbarSlider.hoverBackground": codeColors.dark.selection,
    "scrollbarSlider.activeBackground": codeColors.dark.selection,
    "editorWidget.background": codeColors.dark.background,
    "editorWidget.border": codeColors.dark.muted,
    "editorSuggestWidget.background": codeColors.dark.background,
    "editorSuggestWidget.selectedBackground": codeColors.dark.selection,
    "editorSuggestWidget.highlightForeground": codeColors.dark.keyword,
    "minimapSlider.background": codeColors.dark.selection,
  },
};

export const THEME_NAME_DARK = "proliferate-dark";

export const proliferateLightTheme: MonacoThemeData = {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editorLineNumber.foreground": codeColors.light.muted,
    "editorLineNumber.activeForeground": codeColors.light.foreground,
    "editor.lineHighlightBackground": codeColors.light.selection,
    "editor.lineHighlightBorder": "transparent",
    "editorGutter.background": codeColors.light.background,
    "editorIndentGuide.background": codeColors.light.selection,
    "editorIndentGuide.activeBackground": codeColors.light.selection,
    "scrollbarSlider.background": codeColors.light.selection,
    "scrollbarSlider.hoverBackground": codeColors.light.selection,
    "scrollbarSlider.activeBackground": codeColors.light.selection,
  },
};

export const THEME_NAME_LIGHT = "proliferate-light";
