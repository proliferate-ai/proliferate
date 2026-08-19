/**
 * Heuristic test: does this inline-code string look like a workspace file path?
 *
 * Detect-only — we do not check the filesystem here. Callers may still verify
 * resolution against an actual workspace. False positives are tolerable: a
 * misdetected non-path will simply fail to open and the right-click "Copy
 * path" affordance is still useful.
 *
 * Rules:
 *  - must contain a `/`
 *  - no whitespace
 *  - length-bounded (1..512)
 *  - not a URL (no scheme://, no leading `//`)
 *  - either has a known root segment (relative `./`, `../`, `~/`, `src/`,
 *    `app/`, etc.) OR the basename has a recognizable file extension
 *  - not a glob (no `*`, `?`, `[`, `]`, `{`, `}`)
 */
export function looksLikePath(value: string): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 512) return false;
  if (!trimmed.includes("/")) return false;
  if (/\s/.test(trimmed)) return false;
  if (/[*?[\]{}]/.test(trimmed)) return false;

  // URLs and protocol-relative
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return false;
  if (trimmed.startsWith("//")) return false;

  // Strip an optional :line or :line:col suffix before checking the basename.
  const withoutLineSuffix = trimmed.replace(/:\d+(?::\d+)?$/, "");
  const basename = withoutLineSuffix.split("/").pop() ?? "";
  if (basename.length === 0) {
    // trailing-slash directory like `src/` — accept if the leading segment
    // is a known root.
    return startsWithKnownRoot(withoutLineSuffix);
  }

  if (hasFileExtension(basename)) return true;
  if (startsWithKnownRoot(withoutLineSuffix)) return true;

  return false;
}

/** One ASCII letter, `:`, then one slash — drive-root syntax, not a scheme. */
const DRIVE_ROOT_PREFIX = /^[A-Za-z]:[\\/]/;
/** Any scheme at all. Drive roots are exempted before this runs. */
const ANY_URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
/** Schemes refused even when they wear a `:digits` tail. */
const EXECUTABLE_OR_FOREIGN_SCHEME =
  /^(?:javascript|mailto|data|tel|vbscript|file|about|blob|http|https|ftp|ws|wss|vscode):/i;
/** The whole reference is one path plus a terminal `:line[:column]`. */
const TERMINAL_LINE_SUFFIX_ONLY = /^[^:]+:\d+(?::\d+)?$/;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;
/** Every whitespace character except U+0020, the one the parser may hand us. */
const DISALLOWED_WHITESPACE = /[^\S ]/;
/** `?` and `#` are literal path characters inside an explicit link destination. */
const GLOB_METACHARACTER = /[*[\]{}]/;

/**
 * Heuristic for explicit markdown link destinations. Because the markdown
 * syntax already says "this is a link", this accepts bare filenames that would
 * be too noisy to detect in free text or inline code, and it accepts a literal
 * U+0020 space because a repaired local destination legitimately carries one.
 *
 * The rejections run before the `looksLikePath` delegation on purpose: this
 * grammar is strictly narrower than the free-text one on schemes, controls, and
 * non-space whitespace, so no delegated `true` may escape them. `looksLikePath`
 * itself is unchanged and still rejects all whitespace for its own callers.
 *
 * Detection grants no filesystem authority: everything accepted here still
 * passes through the canonical locator, which is where traversal, drive-root
 * availability, and workspace containment are decided.
 */
export function looksLikeFileReferenceHref(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 512) return false;
  if (CONTROL_CHARACTER.test(trimmed)) return false;
  if (DISALLOWED_WHITESPACE.test(trimmed)) return false;
  if (GLOB_METACHARACTER.test(trimmed)) return false;
  if (trimmed.startsWith("//")) return false;
  if (/^www\./i.test(trimmed)) return false;
  if (trimmed.startsWith("#")) return false;

  // A scheme is an authority grant, not a workspace path. The exact drive-root
  // form is the sole colon exception.
  //
  // `name:12` is genuinely ambiguous between a scheme and a `:line` suffix
  // (`Makefile:12` versus `javascript:1`), so the terminal-line-suffix shape
  // reads as a file reference while the schemes that can carry executable or
  // out-of-workspace meaning are refused outright either way.
  if (EXECUTABLE_OR_FOREIGN_SCHEME.test(trimmed)) return false;
  const terminalLineSuffixOnly = TERMINAL_LINE_SUFFIX_ONLY.test(trimmed);
  if (
    !DRIVE_ROOT_PREFIX.test(trimmed)
    && !terminalLineSuffixOnly
    && ANY_URI_SCHEME.test(trimmed)
  ) {
    return false;
  }

  if (looksLikePath(trimmed)) return true;

  const { path } = splitPathLineSuffix(trimmed);

  const basename = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  if (!basename) return false;
  // The markdown link syntax is already an explicit file-reference signal,
  // so accept extensionless names (VERSION, LICENSE) and bare directory
  // names (apps, scripts). Unresolvable references degrade gracefully.
  return true;
}

const KNOWN_ROOT_SEGMENTS = new Set([
  "src",
  "app",
  "apps",
  "lib",
  "libs",
  "packages",
  "components",
  "pages",
  "hooks",
  "stores",
  "providers",
  "config",
  "platform",
  "server",
  "client",
  "desktop",
  "anyharness",
  "crates",
  "docs",
  "scripts",
  "tests",
  "test",
  "public",
  "assets",
  "node_modules",
]);

function startsWithKnownRoot(value: string): boolean {
  if (value.startsWith("./") || value.startsWith("../") || value.startsWith("~/")) {
    return true;
  }
  if (value.startsWith("/")) {
    // Absolute path — accept; resolver decides if it's inside the workspace.
    return true;
  }
  const firstSegment = value.split("/", 1)[0];
  return KNOWN_ROOT_SEGMENTS.has(firstSegment);
}

function hasFileExtension(basename: string): boolean {
  // Dotfile-only names like ".env" count as extensioned for our purposes.
  if (basename.startsWith(".") && !basename.includes(".", 1)) return true;
  const dot = basename.lastIndexOf(".");
  if (dot <= 0) return false;
  if (dot === basename.length - 1) return false;
  const ext = basename.slice(dot + 1);
  // 1..8 chars, alphanumeric — covers .ts, .tsx, .py, .yaml, .toml, .lock, etc.
  return /^[a-z0-9]{1,8}$/i.test(ext);
}

/**
 * Strip an optional `:line` or `:line:col` suffix from a path string.
 * Returns `{ path, line, column }`.
 */
export function splitPathLineSuffix(value: string): {
  path: string;
  line: number | null;
  column: number | null;
} {
  const match = /^(.*?):(\d+)(?::(\d+))?$/.exec(value);
  if (!match) return { path: value, line: null, column: null };
  return {
    path: match[1],
    line: Number.parseInt(match[2], 10),
    column: match[3] ? Number.parseInt(match[3], 10) : null,
  };
}
