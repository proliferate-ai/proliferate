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
    { settings: { foreground: "#ffffff", background: "#181818" } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "rgba(255,255,255,0.5)" } },
    { scope: ["string", "string.quoted"], settings: { foreground: "#40c977" } },
    { scope: ["constant.numeric", "constant.language"], settings: { foreground: "#ffd240" } },
    { scope: ["keyword", "keyword.control", "keyword.operator.expression", "keyword.operator.new"], settings: { foreground: "#ff6764" } },
    { scope: ["storage.type", "storage.modifier"], settings: { foreground: "#ad7bf9" } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "#ad7bf9" } },
    { scope: ["entity.name.function", "support.function", "meta.function-call entity.name.function"], settings: { foreground: "#ad7bf9" } },
    { scope: ["variable", "variable.other", "variable.other.readwrite", "variable.other.property", "variable.parameter"], settings: { foreground: "#ffd240" } },
    { scope: ["keyword.operator.assignment"], settings: { foreground: "#339cff" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#ff6764" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#ad7bf9" } },
    { scope: ["punctuation", "meta.brace"], settings: { foreground: "rgba(255,255,255,0.6)" } },
    { scope: ["markup.heading"], settings: { foreground: "#ff6764", fontStyle: "bold" } },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
    { scope: ["markup.inserted"], settings: { foreground: "#40c977" } },
    { scope: ["markup.deleted"], settings: { foreground: "#ff6764" } },
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

export async function highlightLines(
  lines: string[],
  languageOrFilename: string,
  theme: HighlightTheme = "dark",
): Promise<HighlightedToken[][]> {
  const lang = inferLanguage(languageOrFilename);
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
