import { createHighlighter, type Highlighter, type BundledLanguage } from "shiki";

let _highlighter: Highlighter | null = null;
let _promise: Promise<Highlighter> | null = null;

const PRELOAD_LANGS: BundledLanguage[] = [
  "typescript", "tsx", "javascript", "jsx",
  "rust", "python", "go", "json", "toml", "yaml",
  "markdown", "css", "html", "sql", "bash", "shell",
  "xml", "diff",
];

// Palettes mirror the Codex reference highlight.js themes
// (reference/codex/styles.css): a restrained five-accent set on a plain
// foreground. Dark is the ChatGPT code palette; light is Atom One Light.
// Operators, punctuation, and HTML tag names intentionally stay at the
// default foreground, matching the reference.
const PROLIFERATE_DARK_THEME = {
  name: "proliferate-dark",
  type: "dark" as const,
  settings: [
    { settings: { foreground: "#FFFFFF", background: "#181818" } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#FFFFFF80" } },
    { scope: ["meta.preprocessor", "punctuation.definition.directive", "keyword.control.directive"], settings: { foreground: "#FFFFFF99" } },
    { scope: ["keyword", "keyword.control", "keyword.operator.expression", "keyword.operator.new", "storage.type", "storage.modifier", "constant.language"], settings: { foreground: "#2E95D3" } },
    { scope: ["string", "string.quoted", "string.template", "string.regexp", "punctuation.definition.string", "markup.inline.raw", "markup.raw.inline", "markup.inserted"], settings: { foreground: "#00A67D" } },
    { scope: ["variable", "variable.other", "variable.other.readwrite", "variable.other.property", "entity.name.type", "support.type", "support.class", "entity.other.attribute-name", "constant.numeric", "support.type.property-name"], settings: { foreground: "#DF3079" } },
    { scope: ["support.function", "support.function.builtin", "entity.name.class", "entity.name.type.class", "support.type.primitive", "support.type.builtin", "support.type.python", "entity.name.function.macro", "support.macro"], settings: { foreground: "#E9950C" } },
    // highlight.js (the Codex renderer) leaves function params and TS/JS
    // local identifiers plain; TextMate grammars tag them all as variable.*.
    { scope: ["variable.parameter", "source.ts variable.other.readwrite", "source.tsx variable.other.readwrite", "source.js variable.other.readwrite", "source.jsx variable.other.readwrite"], settings: { foreground: "#FFFFFF" } },
    { scope: ["entity.name.function", "meta.function-call entity.name.function", "constant.other.symbol"], settings: { foreground: "#F22C3D" } },
    { scope: ["keyword.operator", "punctuation", "meta.brace", "entity.name.tag"], settings: { foreground: "#FFFFFF" } },
    // Per-language corrections matching the Codex highlight.js output.
    { scope: ["entity.name.tag.yaml"], settings: { foreground: "#DF3079" } },
    { scope: ["punctuation.definition.block.sequence.item.yaml"], settings: { foreground: "#F22C3D" } },
    { scope: ["support.type.property-name.css"], settings: { foreground: "#00A67D" } },
    { scope: ["keyword.other.unit"], settings: { foreground: "#DF3079" } },
    { scope: ["punctuation.definition.entity.css"], settings: { foreground: "#DF3079" } },
    { scope: ["punctuation.support.type.property-name.begin.json", "punctuation.support.type.property-name.end.json"], settings: { foreground: "#DF3079" } },
    // Codex leaves shell assignments, bare arguments, and command names plain.
    { scope: ["source.shell variable.other.assignment", "source.shell entity.name.function", "source.shell support.function", "source.shell entity.name.command", "source.shell string.unquoted"], settings: { foreground: "#FFFFFF" } },
    { scope: ["markup.heading"], settings: { foreground: "#F22C3D", fontStyle: "bold" } },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
    { scope: ["markup.deleted"], settings: { foreground: "#F22C3D" } },
  ],
};

const PROLIFERATE_LIGHT_THEME = {
  name: "proliferate-light",
  type: "light" as const,
  settings: [
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
    // Per-language corrections matching the Codex highlight.js output.
    { scope: ["entity.name.tag.yaml"], settings: { foreground: "#986801" } },
    { scope: ["support.type.property-name.css"], settings: { foreground: "#50A14F" } },
    { scope: ["keyword.other.unit"], settings: { foreground: "#986801" } },
    { scope: ["punctuation.support.type.property-name.begin.json", "punctuation.support.type.property-name.end.json"], settings: { foreground: "#986801" } },
    { scope: ["source.shell variable.other.assignment", "source.shell entity.name.function", "source.shell support.function", "source.shell entity.name.command", "source.shell string.unquoted"], settings: { foreground: "#383A42" } },
    { scope: ["markup.heading"], settings: { foreground: "#E45649", fontStyle: "bold" } },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
  ],
};

async function getHighlighter(): Promise<Highlighter> {
  if (_highlighter) return _highlighter;
  if (_promise) return _promise;

  _promise = createHighlighter({
    themes: [PROLIFERATE_DARK_THEME, PROLIFERATE_LIGHT_THEME],
    langs: PRELOAD_LANGS,
  }).then((h) => {
    _highlighter = h;
    return h;
  });

  return _promise;
}

const EXT_TO_LANG: Record<string, BundledLanguage> = {
  ts: "typescript", tsx: "tsx",
  js: "javascript", jsx: "jsx",
  rs: "rust", py: "python", go: "go",
  json: "json", toml: "toml", yaml: "yaml", yml: "yaml",
  md: "markdown", mdx: "markdown",
  css: "css", scss: "css", html: "html", htm: "html",
  sql: "sql", sh: "bash", bash: "bash", zsh: "bash",
  xml: "xml", svg: "xml",
  diff: "diff", patch: "diff",
};

export function inferLanguage(filenameOrLang: string): BundledLanguage {
  const lower = filenameOrLang.toLowerCase();
  if (EXT_TO_LANG[lower]) return EXT_TO_LANG[lower];

  const ext = lower.split(".").pop() ?? "";
  if (EXT_TO_LANG[ext]) return EXT_TO_LANG[ext];

  if (PRELOAD_LANGS.includes(lower as BundledLanguage)) {
    return lower as BundledLanguage;
  }

  return "text" as BundledLanguage;
}

export type HighlightTheme = "dark" | "light";

function resolveThemeName(theme: HighlightTheme): string {
  return theme === "light" ? "proliferate-light" : "proliferate-dark";
}

export async function highlightCode(
  code: string,
  languageOrFilename: string,
  theme: HighlightTheme = "dark",
): Promise<string> {
  const lang = inferLanguage(languageOrFilename);
  try {
    const highlighter = await getHighlighter();
    return highlighter.codeToHtml(code, {
      lang,
      theme: resolveThemeName(theme),
    });
  } catch {
    return `<pre class="shiki"><code>${escapeHtml(code)}</code></pre>`;
  }
}

export interface HighlightedToken {
  content: string;
  color?: string;
}

const CODEX_MARKDOWN_COLORS = {
  dark: {
    foreground: "#FFFFFF",
    muted: "#FFFFFF80",
    string: "#00A67D",
    heading: "#F22C3D",
    emphasis: "#DF3079",
  },
  light: {
    foreground: "#383A42",
    muted: "#A0A1A7",
    string: "#50A14F",
    heading: "#E45649",
    emphasis: "#986801",
  },
} satisfies Record<HighlightTheme, Record<string, string>>;

function token(content: string, color?: string): HighlightedToken {
  return color ? { content, color } : { content };
}

function tokenizeInlineMarkdown(
  line: string,
  colors: typeof CODEX_MARKDOWN_COLORS.dark,
): HighlightedToken[] {
  const tokens: HighlightedToken[] = [];
  const pattern = /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))/g;
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > index) {
      tokens.push(token(line.slice(index, match.index), colors.foreground));
    }

    const value = match[0];
    if (value.startsWith("`")) {
      tokens.push(token("`", colors.muted));
      tokens.push(token(value.slice(1, -1), colors.string));
      tokens.push(token("`", colors.muted));
    } else {
      const closingBracket = value.indexOf("]");
      const openingParen = value.indexOf("(", closingBracket);
      tokens.push(token("[", colors.muted));
      tokens.push(...tokenizeInlineMarkdown(value.slice(1, closingBracket), colors));
      tokens.push(token("]", colors.muted));
      tokens.push(token(value.slice(openingParen), colors.heading));
    }

    index = match.index + value.length;
  }

  if (index < line.length) {
    tokens.push(token(line.slice(index), colors.foreground));
  }

  return tokens.length > 0 ? tokens : [token(line, colors.foreground)];
}

function tokenizeMarkdownFenceLine(
  line: string,
  colors: typeof CODEX_MARKDOWN_COLORS.dark,
): HighlightedToken[] {
  const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
  if (!fenceMatch) return [token(line, colors.foreground)];

  const [, indent, fence, rest] = fenceMatch;
  return [
    ...(indent ? [token(indent, colors.foreground)] : []),
    token(fence, colors.muted),
    ...(rest ? [token(rest, colors.foreground)] : []),
  ];
}

export function highlightMarkdownDiffLines(
  lines: string[],
  theme: HighlightTheme = "dark",
): HighlightedToken[][] {
  const colors = CODEX_MARKDOWN_COLORS[theme];
  let inFence = false;

  return lines.map((line) => {
    const isFenceLine = /^\s*(`{3,}|~{3,})/.test(line);
    if (isFenceLine) {
      const tokens = tokenizeMarkdownFenceLine(line, colors);
      inFence = !inFence;
      return tokens;
    }

    if (inFence) {
      return [token(line, colors.foreground)];
    }

    if (/^#{1,6}(?:\s|$)/.test(line)) {
      return [token(line, colors.heading)];
    }

    if (/^\*\*[^*].*\*\*$/.test(line)) {
      return [token(line, colors.emphasis)];
    }

    const listMatch = line.match(/^(\s*)([-*+])(\s+.*)$/);
    if (listMatch) {
      const [, indent, marker, rest] = listMatch;
      return [
        ...(indent ? [token(indent, colors.foreground)] : []),
        token(marker, colors.heading),
        ...tokenizeInlineMarkdown(rest, colors),
      ];
    }

    return tokenizeInlineMarkdown(line, colors);
  });
}

export async function highlightLines(
  lines: string[],
  languageOrFilename: string,
  theme: HighlightTheme = "dark",
): Promise<HighlightedToken[][]> {
  const lang = inferLanguage(languageOrFilename);
  if (lang === "markdown") {
    return highlightMarkdownDiffLines(lines, theme);
  }

  try {
    const highlighter = await getHighlighter();
    const { tokens } = highlighter.codeToTokens(lines.join("\n"), {
      lang,
      theme: resolveThemeName(theme),
    });
    return tokens.map((lineTokens) =>
      lineTokens.map((t) => ({ content: t.content, color: t.color })),
    );
  } catch {
    return lines.map((line) => [{ content: line }]);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
