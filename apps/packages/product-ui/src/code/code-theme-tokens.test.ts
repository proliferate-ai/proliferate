import { codeColors } from "@proliferate/design/tokens";
import { describe, expect, it } from "vitest";
import * as codeThemeTokens from "./code-theme-tokens";
import {
  type CodeThemeDefinition,
  PROLIFERATE_DARK_THEME,
  PROLIFERATE_LIGHT_THEME,
  toShikiTheme,
} from "./code-theme-tokens";

const DARK_SCOPES = [
  undefined,
  ["comment", "punctuation.definition.comment"],
  ["meta.preprocessor", "punctuation.definition.directive", "keyword.control.directive"],
  ["keyword", "keyword.control", "keyword.operator.expression", "keyword.operator.new", "storage.type", "storage.modifier", "constant.language"],
  ["string", "string.quoted", "string.template", "string.regexp", "punctuation.definition.string", "markup.inline.raw", "markup.raw.inline", "markup.inserted"],
  ["variable", "variable.other", "variable.other.readwrite", "variable.other.property", "entity.name.type", "support.type", "support.class", "entity.other.attribute-name", "constant.numeric", "support.type.property-name"],
  ["support.function", "support.function.builtin", "entity.name.class", "entity.name.type.class", "support.type.primitive", "support.type.builtin", "support.type.python", "entity.name.function.macro", "support.macro"],
  ["variable.parameter", "source.ts variable.other.readwrite", "source.tsx variable.other.readwrite", "source.js variable.other.readwrite", "source.jsx variable.other.readwrite"],
  ["entity.name.function", "meta.function-call entity.name.function", "constant.other.symbol"],
  ["keyword.operator", "punctuation", "meta.brace", "entity.name.tag"],
  ["entity.name.tag.yaml"],
  ["punctuation.definition.block.sequence.item.yaml"],
  ["support.type.property-name.css"],
  ["keyword.other.unit"],
  ["punctuation.definition.entity.css"],
  ["punctuation.support.type.property-name.begin.json", "punctuation.support.type.property-name.end.json"],
  ["source.shell variable.other.assignment", "source.shell entity.name.function", "source.shell support.function", "source.shell entity.name.command", "source.shell string.unquoted"],
  ["markup.heading"],
  ["markup.bold"],
  ["markup.italic"],
  ["markup.deleted"],
] as const;

const LIGHT_SCOPES = [
  undefined,
  ["comment", "punctuation.definition.comment"],
  ["keyword", "keyword.control", "keyword.operator.expression", "keyword.operator.new", "storage.type", "storage.modifier"],
  ["constant.language"],
  ["string", "string.quoted", "string.template", "string.regexp", "punctuation.definition.string", "markup.inserted"],
  ["variable", "variable.other", "variable.other.readwrite", "variable.other.property", "entity.name.type", "support.type", "support.class", "entity.other.attribute-name", "constant.numeric", "support.type.property-name"],
  ["support.function", "support.function.builtin", "entity.name.class", "entity.name.type.class", "support.type.primitive", "support.type.builtin", "support.type.python", "entity.name.function.macro", "support.macro"],
  ["variable.parameter", "source.ts variable.other.readwrite", "source.tsx variable.other.readwrite", "source.js variable.other.readwrite", "source.jsx variable.other.readwrite"],
  ["entity.name.function", "meta.function-call entity.name.function", "constant.other.symbol"],
  ["entity.name.tag", "markup.deleted"],
  ["keyword.operator", "punctuation", "meta.brace"],
  ["entity.name.tag.yaml"],
  ["support.type.property-name.css"],
  ["keyword.other.unit"],
  ["punctuation.support.type.property-name.begin.json", "punctuation.support.type.property-name.end.json"],
  ["source.shell variable.other.assignment", "source.shell entity.name.function", "source.shell support.function", "source.shell entity.name.command", "source.shell string.unquoted"],
  ["markup.heading"],
  ["markup.bold"],
  ["markup.italic"],
] as const;

function palette(variant: typeof codeColors.dark | typeof codeColors.light) {
  return {
    foreground: variant.foreground,
    background: variant.background,
    muted: variant.muted,
    string: variant.string,
    heading: variant.heading,
    emphasis: variant.emphasis,
  };
}

describe("code theme token exports", () => {
  it("retains the exact runtime export surface", () => {
    expect(Object.keys(codeThemeTokens).sort()).toEqual([
      "PROLIFERATE_DARK_THEME",
      "PROLIFERATE_LIGHT_THEME",
      "toShikiTheme",
    ]);
  });

  it("derives both public palettes from design", () => {
    expect(PROLIFERATE_DARK_THEME).toMatchObject({
      name: "proliferate-dark",
      type: "dark",
      palette: palette(codeColors.dark),
    });
    expect(PROLIFERATE_LIGHT_THEME).toMatchObject({
      name: "proliferate-light",
      type: "light",
      palette: palette(codeColors.light),
    });
  });

  it("retains the exact TextMate scope and font-style shapes", () => {
    expect(PROLIFERATE_DARK_THEME.settings.map((entry) => entry.scope))
      .toEqual(DARK_SCOPES);
    expect(PROLIFERATE_LIGHT_THEME.settings.map((entry) => entry.scope))
      .toEqual(LIGHT_SCOPES);
    expect(PROLIFERATE_DARK_THEME.settings.map((entry) => entry.settings.fontStyle))
      .toEqual([
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, "bold", "bold", "italic", undefined,
      ]);
    expect(PROLIFERATE_LIGHT_THEME.settings.map((entry) => entry.settings.fontStyle))
      .toEqual([
        undefined, "italic", undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, "bold", "bold", "italic",
      ]);
    expect(PROLIFERATE_DARK_THEME.settings[0]?.settings).toEqual({
      foreground: codeColors.dark.foreground,
      background: codeColors.dark.background,
    });
    expect(PROLIFERATE_LIGHT_THEME.settings[0]?.settings).toEqual({
      foreground: codeColors.light.foreground,
      background: codeColors.light.background,
    });
  });

  it("uses only design-owned colors in every TextMate setting", () => {
    const variants: Array<[CodeThemeDefinition, ReadonlySet<string>]> = [
      [PROLIFERATE_DARK_THEME, new Set<string>(Object.values(codeColors.dark))],
      [PROLIFERATE_LIGHT_THEME, new Set<string>(Object.values(codeColors.light))],
    ];

    for (const [theme, allowedColors] of variants) {
      for (const setting of theme.settings) {
        if (setting.settings.foreground) {
          expect(allowedColors.has(setting.settings.foreground)).toBe(true);
        }
        if (setting.settings.background) {
          expect(allowedColors.has(setting.settings.background)).toBe(true);
        }
      }
    }
  });

  it("projects the exact Shiki shape while retaining palette on the source definition", () => {
    expect(toShikiTheme(PROLIFERATE_DARK_THEME)).toEqual({
      name: "proliferate-dark",
      type: "dark",
      settings: PROLIFERATE_DARK_THEME.settings,
    });
    expect(toShikiTheme(PROLIFERATE_LIGHT_THEME)).toEqual({
      name: "proliferate-light",
      type: "light",
      settings: PROLIFERATE_LIGHT_THEME.settings,
    });
    expect("palette" in toShikiTheme(PROLIFERATE_DARK_THEME)).toBe(false);
  });
});
