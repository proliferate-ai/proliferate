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
    { settings: { foreground: "#eae8e6", background: "#140f0e" } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#8e8885" } },
    { scope: ["string", "string.quoted"], settings: { foreground: "#4ade80" } },
    { scope: ["constant.numeric", "constant.language"], settings: { foreground: "#fb923c" } },
    { scope: ["keyword", "storage.type", "storage.modifier"], settings: { foreground: "#e852ff" } },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: "#61a6fa" } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "#61a6fa" } },
    { scope: ["variable", "variable.other"], settings: { foreground: "#eae8e6" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#f87272" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#ddc1b1" } },
    { scope: ["punctuation", "meta.brace"], settings: { foreground: "#bcb6b3" } },
    { scope: ["markup.heading"], settings: { foreground: "#61a6fa", fontStyle: "bold" } },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
    { scope: ["markup.inserted"], settings: { foreground: "#4ade80" } },
    { scope: ["markup.deleted"], settings: { foreground: "#f87272" } },
  ],
};

const PROLIFERATE_LIGHT_THEME = {
  name: "proliferate-light",
  type: "light" as const,
  settings: [
    { settings: { foreground: "#1a1a1a", background: "#ffffff" } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#6b7280" } },
    { scope: ["string", "string.quoted"], settings: { foreground: "#059669" } },
    { scope: ["constant.numeric", "constant.language"], settings: { foreground: "#d97706" } },
    { scope: ["keyword", "storage.type", "storage.modifier"], settings: { foreground: "#7c3aed" } },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: "#2563eb" } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "#2563eb" } },
    { scope: ["variable", "variable.other"], settings: { foreground: "#1a1a1a" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#dc2626" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#92400e" } },
    { scope: ["punctuation", "meta.brace"], settings: { foreground: "#6b7280" } },
    { scope: ["markup.heading"], settings: { foreground: "#2563eb", fontStyle: "bold" } },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
    { scope: ["markup.inserted"], settings: { foreground: "#059669" } },
    { scope: ["markup.deleted"], settings: { foreground: "#dc2626" } },
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
