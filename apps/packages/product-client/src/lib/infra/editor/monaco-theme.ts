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

function monacoHex(color: string): string {
  return color.startsWith("#") ? color.slice(1) : color;
}

/**
 * Monaco retains its established token and editor-color shape while resolving
 * every palette value through the design package's code authority.
 */
export const proliferateDarkTheme: MonacoThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: monacoHex(codeColors.dark.muted), fontStyle: "italic" },
    { token: "keyword", foreground: monacoHex(codeColors.dark.keyword) },
    { token: "keyword.control", foreground: monacoHex(codeColors.dark.keyword) },
    { token: "storage", foreground: monacoHex(codeColors.dark.keyword) },
    { token: "storage.type", foreground: monacoHex(codeColors.dark.keyword) },
    { token: "string", foreground: monacoHex(codeColors.dark.string) },
    { token: "string.key.json", foreground: monacoHex(codeColors.dark.emphasis) },
    { token: "number", foreground: monacoHex(codeColors.dark.emphasis) },
    { token: "constant", foreground: monacoHex(codeColors.dark.emphasis) },
    { token: "type", foreground: monacoHex(codeColors.dark.support) },
    { token: "type.identifier", foreground: monacoHex(codeColors.dark.support) },
    { token: "entity.name.type", foreground: monacoHex(codeColors.dark.support) },
    { token: "entity.name.function", foreground: monacoHex(codeColors.dark.heading) },
    { token: "variable", foreground: monacoHex(codeColors.dark.foreground) },
    { token: "variable.predefined", foreground: monacoHex(codeColors.dark.support) },
    { token: "delimiter", foreground: monacoHex(codeColors.dark.muted) },
    { token: "delimiter.bracket", foreground: monacoHex(codeColors.dark.muted) },
    { token: "operator", foreground: monacoHex(codeColors.dark.muted) },
    { token: "tag", foreground: monacoHex(codeColors.dark.string) },
    { token: "attribute.name", foreground: monacoHex(codeColors.dark.emphasis) },
    { token: "attribute.value", foreground: monacoHex(codeColors.dark.string) },
    { token: "metatag", foreground: monacoHex(codeColors.dark.string) },
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
