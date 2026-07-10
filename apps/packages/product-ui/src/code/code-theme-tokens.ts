/**
 * Code highlighting theme definitions extracted from the desktop editor.
 *
 * The types are structured so that color values can be literal hex strings
 * *or* CSS color-mix()/light-dark() expressions — allowing progressive
 * enhancement without a runtime rewrite.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single TextMate color setting entry. `foreground` and `background` may be
 * hex values, CSS color-mix() expressions, or light-dark() strings.
 */
export interface CodeThemeSettingEntry {
  scope?: string | string[];
  settings: {
    foreground?: string;
    background?: string;
    fontStyle?: string;
  };
}

/**
 * High-level palette for a single theme variant. Useful for non-TextMate
 * rendering contexts (markdown diff preview, plain-token fallback).
 */
export interface CodeThemePalette {
  foreground: string;
  background: string;
  /** Half-opacity muted text (comments, punctuation) */
  muted: string;
  /** String/inserted literals */
  string: string;
  /** Heading-level emphasis (headings, markers) */
  heading: string;
  /** Secondary emphasis (bold lines, attribute names) */
  emphasis: string;
}

export interface CodeThemeDefinition {
  name: string;
  type: "dark" | "light";
  palette: CodeThemePalette;
  settings: CodeThemeSettingEntry[];
}

// ---------------------------------------------------------------------------
// Dark theme
// ---------------------------------------------------------------------------

const DARK_PALETTE: CodeThemePalette = {
  foreground: "#FFFFFF",
  background: "#181818",
  muted: "#FFFFFF80",
  string: "#00A67D",
  heading: "#F22C3D",
  emphasis: "#DF3079",
};

const DARK_SETTINGS: CodeThemeSettingEntry[] = [
  { settings: { foreground: "#FFFFFF", background: "#181818" } },
  { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#FFFFFF80" } },
  { scope: ["meta.preprocessor", "punctuation.definition.directive", "keyword.control.directive"], settings: { foreground: "#FFFFFF99" } },
  { scope: ["keyword", "keyword.control", "keyword.operator.expression", "keyword.operator.new", "storage.type", "storage.modifier", "constant.language"], settings: { foreground: "#2E95D3" } },
  { scope: ["string", "string.quoted", "string.template", "string.regexp", "punctuation.definition.string", "markup.inline.raw", "markup.raw.inline", "markup.inserted"], settings: { foreground: "#00A67D" } },
  { scope: ["variable", "variable.other", "variable.other.readwrite", "variable.other.property", "entity.name.type", "support.type", "support.class", "entity.other.attribute-name", "constant.numeric", "support.type.property-name"], settings: { foreground: "#DF3079" } },
  { scope: ["support.function", "support.function.builtin", "entity.name.class", "entity.name.type.class", "support.type.primitive", "support.type.builtin", "support.type.python", "entity.name.function.macro", "support.macro"], settings: { foreground: "#E9950C" } },
  { scope: ["variable.parameter", "source.ts variable.other.readwrite", "source.tsx variable.other.readwrite", "source.js variable.other.readwrite", "source.jsx variable.other.readwrite"], settings: { foreground: "#FFFFFF" } },
  { scope: ["entity.name.function", "meta.function-call entity.name.function", "constant.other.symbol"], settings: { foreground: "#F22C3D" } },
  { scope: ["keyword.operator", "punctuation", "meta.brace", "entity.name.tag"], settings: { foreground: "#FFFFFF" } },
  { scope: ["entity.name.tag.yaml"], settings: { foreground: "#DF3079" } },
  { scope: ["punctuation.definition.block.sequence.item.yaml"], settings: { foreground: "#F22C3D" } },
  { scope: ["support.type.property-name.css"], settings: { foreground: "#00A67D" } },
  { scope: ["keyword.other.unit"], settings: { foreground: "#DF3079" } },
  { scope: ["punctuation.definition.entity.css"], settings: { foreground: "#DF3079" } },
  { scope: ["punctuation.support.type.property-name.begin.json", "punctuation.support.type.property-name.end.json"], settings: { foreground: "#DF3079" } },
  { scope: ["source.shell variable.other.assignment", "source.shell entity.name.function", "source.shell support.function", "source.shell entity.name.command", "source.shell string.unquoted"], settings: { foreground: "#FFFFFF" } },
  { scope: ["markup.heading"], settings: { foreground: "#F22C3D", fontStyle: "bold" } },
  { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
  { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
  { scope: ["markup.deleted"], settings: { foreground: "#F22C3D" } },
];

export const PROLIFERATE_DARK_THEME: CodeThemeDefinition = {
  name: "proliferate-dark",
  type: "dark",
  palette: DARK_PALETTE,
  settings: DARK_SETTINGS,
};

// ---------------------------------------------------------------------------
// Light theme
// ---------------------------------------------------------------------------

const LIGHT_PALETTE: CodeThemePalette = {
  foreground: "#383A42",
  background: "#ffffff",
  muted: "#A0A1A7",
  string: "#50A14F",
  heading: "#E45649",
  emphasis: "#986801",
};

const LIGHT_SETTINGS: CodeThemeSettingEntry[] = [
  { settings: { foreground: "#383A42", background: "#ffffff" } },
  { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#A0A1A7", fontStyle: "italic" } },
  { scope: ["keyword", "keyword.control", "keyword.operator.expression", "keyword.operator.new", "storage.type", "storage.modifier"], settings: { foreground: "#A626A4" } },
  { scope: ["constant.language"], settings: { foreground: "#0184BB" } },
  { scope: ["string", "string.quoted", "string.template", "string.regexp", "punctuation.definition.string", "markup.inserted"], settings: { foreground: "#50A14F" } },
  { scope: ["variable", "variable.other", "variable.other.readwrite", "variable.other.property", "entity.name.type", "support.type", "support.class", "entity.other.attribute-name", "constant.numeric", "support.type.property-name"], settings: { foreground: "#986801" } },
  { scope: ["support.function", "support.function.builtin", "entity.name.class", "entity.name.type.class", "support.type.primitive", "support.type.builtin", "support.type.python", "entity.name.function.macro", "support.macro"], settings: { foreground: "#C18401" } },
  { scope: ["variable.parameter", "source.ts variable.other.readwrite", "source.tsx variable.other.readwrite", "source.js variable.other.readwrite", "source.jsx variable.other.readwrite"], settings: { foreground: "#383A42" } },
  { scope: ["entity.name.function", "meta.function-call entity.name.function", "constant.other.symbol"], settings: { foreground: "#4078F2" } },
  { scope: ["entity.name.tag", "markup.deleted"], settings: { foreground: "#E45649" } },
  { scope: ["keyword.operator", "punctuation", "meta.brace"], settings: { foreground: "#383A42" } },
  { scope: ["entity.name.tag.yaml"], settings: { foreground: "#986801" } },
  { scope: ["support.type.property-name.css"], settings: { foreground: "#50A14F" } },
  { scope: ["keyword.other.unit"], settings: { foreground: "#986801" } },
  { scope: ["punctuation.support.type.property-name.begin.json", "punctuation.support.type.property-name.end.json"], settings: { foreground: "#986801" } },
  { scope: ["source.shell variable.other.assignment", "source.shell entity.name.function", "source.shell support.function", "source.shell entity.name.command", "source.shell string.unquoted"], settings: { foreground: "#383A42" } },
  { scope: ["markup.heading"], settings: { foreground: "#E45649", fontStyle: "bold" } },
  { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
  { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
];

export const PROLIFERATE_LIGHT_THEME: CodeThemeDefinition = {
  name: "proliferate-light",
  type: "light",
  palette: LIGHT_PALETTE,
  settings: LIGHT_SETTINGS,
};

/**
 * Resolve a CodeThemeDefinition to the format shiki expects for
 * `createHighlighter({ themes: [...] })`. The `settings` array is directly
 * compatible with shiki's TextMate theme format.
 */
export function toShikiTheme(def: CodeThemeDefinition) {
  return {
    name: def.name,
    type: def.type,
    settings: def.settings,
  };
}
