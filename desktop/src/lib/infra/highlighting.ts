import { createHighlighter, type Highlighter, type BundledLanguage } from "shiki";

let _highlighter: Highlighter | null = null;
let _promise: Promise<Highlighter> | null = null;

const PRELOAD_LANGS: BundledLanguage[] = [
  "typescript", "tsx", "javascript", "jsx",
  "rust", "python", "go", "json", "toml", "yaml",
  "markdown", "css", "html", "sql", "bash", "shell",
  "xml", "diff",
];

const PROLIFERATE_DARK_THEME = {
  name: "proliferate-dark",
  type: "dark" as const,
  settings: [
    { settings: { foreground: "#FCFCFC", background: "#181818" } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#999999" } },
    { scope: ["string", "string.quoted", "markup.inline.raw", "markup.raw.inline"], settings: { foreground: "#85DF7B" } },
    { scope: ["constant.numeric", "constant.language"], settings: { foreground: "#6DCBF4" } },
    { scope: ["keyword", "keyword.control", "keyword.operator.expression", "keyword.operator.new"], settings: { foreground: "#F67576" } },
    { scope: ["storage.type", "storage.modifier"], settings: { foreground: "#B06DFF" } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "#B06DFF" } },
    { scope: ["entity.name.function", "support.function", "meta.function-call entity.name.function"], settings: { foreground: "#B06DFF" } },
    { scope: ["variable", "variable.other", "variable.other.readwrite", "variable.other.property", "variable.parameter"], settings: { foreground: "#FA994C" } },
    { scope: ["keyword.operator", "keyword.operator.assignment"], settings: { foreground: "#6DCBF4" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#F67576" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#B06DFF" } },
    { scope: ["punctuation", "meta.brace"], settings: { foreground: "#999999" } },
    { scope: ["markup.heading"], settings: { foreground: "#F67576", fontStyle: "bold" } },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
    { scope: ["markup.inserted"], settings: { foreground: "#40C977" } },
    { scope: ["markup.deleted"], settings: { foreground: "#F67576" } },
  ],
};

const PROLIFERATE_LIGHT_THEME = {
  name: "proliferate-light",
  type: "light" as const,
  settings: [
    { settings: { foreground: "#0d0d0d", background: "#ffffff" } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#949494" } },
    { scope: ["string", "string.quoted"], settings: { foreground: "#008809" } },
    { scope: ["constant.numeric", "constant.language"], settings: { foreground: "#bd5800" } },
    { scope: ["keyword", "keyword.control", "keyword.operator.expression", "keyword.operator.new"], settings: { foreground: "#d53538" } },
    { scope: ["storage.type", "storage.modifier"], settings: { foreground: "#751ed9" } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "#751ed9" } },
    { scope: ["entity.name.function", "support.function", "meta.function-call entity.name.function"], settings: { foreground: "#751ed9" } },
    { scope: ["variable", "variable.other", "variable.other.readwrite", "variable.other.property", "variable.parameter"], settings: { foreground: "#bd5800" } },
    { scope: ["keyword.operator.assignment"], settings: { foreground: "#0071ea" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#d53538" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#751ed9" } },
    { scope: ["punctuation", "meta.brace"], settings: { foreground: "#666666" } },
    { scope: ["markup.heading"], settings: { foreground: "#d53538", fontStyle: "bold" } },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
    { scope: ["markup.inserted"], settings: { foreground: "#008809" } },
    { scope: ["markup.deleted"], settings: { foreground: "#d53538" } },
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
    foreground: "#FCFCFC",
    muted: "#999999",
    string: "#85DF7B",
    heading: "#F67576",
    emphasis: "#FA994C",
  },
  light: {
    foreground: "#0d0d0d",
    muted: "#666666",
    string: "#008809",
    heading: "#d53538",
    emphasis: "#bd5800",
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
