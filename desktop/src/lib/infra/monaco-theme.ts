/**
 * Custom Monaco theme matched to the Proliferate ship palette.
 * Extends vs-dark, overrides editor chrome + key syntax token colors.
 *
 * Type matches monaco.editor.IStandaloneThemeData — inlined to avoid
 * a direct monaco-editor import (types live inside pnpm store).
 */
export const proliferateDarkTheme: {
  base: "vs" | "vs-dark" | "hc-black";
  inherit: boolean;
  rules: Array<{
    token: string;
    foreground?: string;
    background?: string;
    fontStyle?: string;
  }>;
  colors: Record<string, string>;
} = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6B6560", fontStyle: "italic" },
    { token: "keyword", foreground: "D4A574" },
    { token: "keyword.control", foreground: "D4A574" },
    { token: "storage", foreground: "D4A574" },
    { token: "storage.type", foreground: "D4A574" },
    { token: "string", foreground: "8FAADC" },
    { token: "string.key.json", foreground: "C9A070" },
    { token: "number", foreground: "C9A070" },
    { token: "constant", foreground: "C9A070" },
    { token: "type", foreground: "CDA574" },
    { token: "type.identifier", foreground: "CDA574" },
    { token: "entity.name.type", foreground: "CDA574" },
    { token: "entity.name.function", foreground: "E0D0C0" },
    { token: "variable", foreground: "E8E4E0" },
    { token: "variable.predefined", foreground: "CDA574" },
    { token: "delimiter", foreground: "8C8580" },
    { token: "delimiter.bracket", foreground: "A09890" },
    { token: "operator", foreground: "A09890" },
    { token: "tag", foreground: "9BC4A8" },
    { token: "attribute.name", foreground: "C9A070" },
    { token: "attribute.value", foreground: "8FAADC" },
    { token: "metatag", foreground: "9BC4A8" },
  ],
  colors: {
    // Editor background — slightly lifted from app bg for readability
    "editor.background": "#1A1715",
    "editor.foreground": "#E8E4E0",

    // Line highlight — very subtle, inspired by Lovable's 6% white overlay
    "editor.lineHighlightBackground": "#ffffff08",
    "editor.lineHighlightBorder": "#00000000",

    // Selection
    "editor.selectionBackground": "#3D353080",
    "editor.inactiveSelectionBackground": "#3D353040",
    "editor.selectionHighlightBackground": "#3D353030",

    // Find matches
    "editor.findMatchBackground": "#D4A57440",
    "editor.findMatchHighlightBackground": "#D4A57420",

    // Cursor
    "editorCursor.foreground": "#E8E4E0",

    // Line numbers — muted, Lovable-style
    "editorLineNumber.foreground": "#5C5854",
    "editorLineNumber.activeForeground": "#A09890",

    // Gutter
    "editorGutter.background": "#1A1715",

    // Indentation guides
    "editorIndentGuide.background": "#ffffff08",
    "editorIndentGuide.activeBackground": "#ffffff14",

    // Bracket match
    "editorBracketMatch.background": "#D4A57420",
    "editorBracketMatch.border": "#D4A57460",

    // Scrollbar
    "scrollbarSlider.background": "#ffffff10",
    "scrollbarSlider.hoverBackground": "#ffffff18",
    "scrollbarSlider.activeBackground": "#ffffff24",

    // Widget (autocomplete, hover)
    "editorWidget.background": "#1E1B18",
    "editorWidget.border": "#2C2825",
    "editorSuggestWidget.background": "#1E1B18",
    "editorSuggestWidget.selectedBackground": "#2C2825",
    "editorSuggestWidget.highlightForeground": "#D4A574",

    // No minimap border
    "minimapSlider.background": "#ffffff10",
  },
};

export const THEME_NAME_DARK = "proliferate-dark";

type MonacoThemeData = typeof proliferateDarkTheme;

export const proliferateLightTheme: MonacoThemeData = {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    // Line numbers — warm gray, not green
    "editorLineNumber.foreground": "#A09890",
    "editorLineNumber.activeForeground": "#6B6560",

    // Subtle line highlight
    "editor.lineHighlightBackground": "#00000006",
    "editor.lineHighlightBorder": "#00000000",

    // Gutter matches editor bg
    "editorGutter.background": "#ffffff",

    // Indentation guides
    "editorIndentGuide.background": "#00000008",
    "editorIndentGuide.activeBackground": "#00000014",

    // Scrollbar
    "scrollbarSlider.background": "#00000010",
    "scrollbarSlider.hoverBackground": "#00000018",
    "scrollbarSlider.activeBackground": "#00000024",
  },
};

export const THEME_NAME_LIGHT = "proliferate-light";
