import { codeColors } from "@proliferate/design/tokens";

export interface CodeThemeSettingEntry {
  scope?: string | string[];
  settings: {
    foreground?: string;
    background?: string;
    fontStyle?: string;
  };
}

export interface CodeThemePalette {
  foreground: string;
  background: string;
  /** Half-opacity muted text (comments, punctuation). */
  muted: string;
  /** String/inserted literals. */
  string: string;
  /** Heading-level emphasis (headings, markers). */
  heading: string;
  /** Secondary emphasis (bold lines, attribute names). */
  emphasis: string;
}

export interface CodeThemeDefinition {
  name: string;
  type: "dark" | "light";
  palette: CodeThemePalette;
  settings: CodeThemeSettingEntry[];
}

const DARK_PALETTE: CodeThemePalette = {
  foreground: codeColors.dark.foreground,
  background: codeColors.dark.background,
  muted: codeColors.dark.muted,
  string: codeColors.dark.string,
  heading: codeColors.dark.heading,
  emphasis: codeColors.dark.emphasis,
};

const DARK_SETTINGS: CodeThemeSettingEntry[] = [
  { settings: { foreground: codeColors.dark.foreground, background: codeColors.dark.background } },
  { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: codeColors.dark.muted } },
  { scope: ["meta.preprocessor", "punctuation.definition.directive", "keyword.control.directive"], settings: { foreground: codeColors.dark.muted } },
  { scope: ["keyword", "keyword.control", "keyword.operator.expression", "keyword.operator.new", "storage.type", "storage.modifier", "constant.language"], settings: { foreground: codeColors.dark.keyword } },
  { scope: ["string", "string.quoted", "string.template", "string.regexp", "punctuation.definition.string", "markup.inline.raw", "markup.raw.inline", "markup.inserted"], settings: { foreground: codeColors.dark.string } },
  { scope: ["variable", "variable.other", "variable.other.readwrite", "variable.other.property", "entity.name.type", "support.type", "support.class", "entity.other.attribute-name", "constant.numeric", "support.type.property-name"], settings: { foreground: codeColors.dark.emphasis } },
  { scope: ["support.function", "support.function.builtin", "entity.name.class", "entity.name.type.class", "support.type.primitive", "support.type.builtin", "support.type.python", "entity.name.function.macro", "support.macro"], settings: { foreground: codeColors.dark.support } },
  { scope: ["variable.parameter", "source.ts variable.other.readwrite", "source.tsx variable.other.readwrite", "source.js variable.other.readwrite", "source.jsx variable.other.readwrite"], settings: { foreground: codeColors.dark.foreground } },
  { scope: ["entity.name.function", "meta.function-call entity.name.function", "constant.other.symbol"], settings: { foreground: codeColors.dark.heading } },
  { scope: ["keyword.operator", "punctuation", "meta.brace", "entity.name.tag"], settings: { foreground: codeColors.dark.foreground } },
  { scope: ["entity.name.tag.yaml"], settings: { foreground: codeColors.dark.emphasis } },
  { scope: ["punctuation.definition.block.sequence.item.yaml"], settings: { foreground: codeColors.dark.heading } },
  { scope: ["support.type.property-name.css"], settings: { foreground: codeColors.dark.string } },
  { scope: ["keyword.other.unit"], settings: { foreground: codeColors.dark.emphasis } },
  { scope: ["punctuation.definition.entity.css"], settings: { foreground: codeColors.dark.emphasis } },
  { scope: ["punctuation.support.type.property-name.begin.json", "punctuation.support.type.property-name.end.json"], settings: { foreground: codeColors.dark.emphasis } },
  { scope: ["source.shell variable.other.assignment", "source.shell entity.name.function", "source.shell support.function", "source.shell entity.name.command", "source.shell string.unquoted"], settings: { foreground: codeColors.dark.foreground } },
  { scope: ["markup.heading"], settings: { foreground: codeColors.dark.heading, fontStyle: "bold" } },
  { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
  { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
  { scope: ["markup.deleted"], settings: { foreground: codeColors.dark.diffDeleted } },
];

export const PROLIFERATE_DARK_THEME: CodeThemeDefinition = {
  name: "proliferate-dark",
  type: "dark",
  palette: DARK_PALETTE,
  settings: DARK_SETTINGS,
};

const LIGHT_PALETTE: CodeThemePalette = {
  foreground: codeColors.light.foreground,
  background: codeColors.light.background,
  muted: codeColors.light.muted,
  string: codeColors.light.string,
  heading: codeColors.light.heading,
  emphasis: codeColors.light.emphasis,
};

const LIGHT_SETTINGS: CodeThemeSettingEntry[] = [
  { settings: { foreground: codeColors.light.foreground, background: codeColors.light.background } },
  { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: codeColors.light.muted, fontStyle: "italic" } },
  { scope: ["keyword", "keyword.control", "keyword.operator.expression", "keyword.operator.new", "storage.type", "storage.modifier"], settings: { foreground: codeColors.light.keyword } },
  { scope: ["constant.language"], settings: { foreground: codeColors.light.keyword } },
  { scope: ["string", "string.quoted", "string.template", "string.regexp", "punctuation.definition.string", "markup.inserted"], settings: { foreground: codeColors.light.string } },
  { scope: ["variable", "variable.other", "variable.other.readwrite", "variable.other.property", "entity.name.type", "support.type", "support.class", "entity.other.attribute-name", "constant.numeric", "support.type.property-name"], settings: { foreground: codeColors.light.emphasis } },
  { scope: ["support.function", "support.function.builtin", "entity.name.class", "entity.name.type.class", "support.type.primitive", "support.type.builtin", "support.type.python", "entity.name.function.macro", "support.macro"], settings: { foreground: codeColors.light.support } },
  { scope: ["variable.parameter", "source.ts variable.other.readwrite", "source.tsx variable.other.readwrite", "source.js variable.other.readwrite", "source.jsx variable.other.readwrite"], settings: { foreground: codeColors.light.foreground } },
  { scope: ["entity.name.function", "meta.function-call entity.name.function", "constant.other.symbol"], settings: { foreground: codeColors.light.heading } },
  { scope: ["entity.name.tag", "markup.deleted"], settings: { foreground: codeColors.light.heading } },
  { scope: ["keyword.operator", "punctuation", "meta.brace"], settings: { foreground: codeColors.light.foreground } },
  { scope: ["entity.name.tag.yaml"], settings: { foreground: codeColors.light.emphasis } },
  { scope: ["support.type.property-name.css"], settings: { foreground: codeColors.light.string } },
  { scope: ["keyword.other.unit"], settings: { foreground: codeColors.light.emphasis } },
  { scope: ["punctuation.support.type.property-name.begin.json", "punctuation.support.type.property-name.end.json"], settings: { foreground: codeColors.light.emphasis } },
  { scope: ["source.shell variable.other.assignment", "source.shell entity.name.function", "source.shell support.function", "source.shell entity.name.command", "source.shell string.unquoted"], settings: { foreground: codeColors.light.foreground } },
  { scope: ["markup.heading"], settings: { foreground: codeColors.light.heading, fontStyle: "bold" } },
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
 * Resolve a definition to the TextMate format consumed by Shiki while
 * retaining the richer palette on the public Proliferate definition.
 */
export function toShikiTheme(definition: CodeThemeDefinition) {
  return {
    name: definition.name,
    type: definition.type,
    settings: definition.settings,
  };
}
