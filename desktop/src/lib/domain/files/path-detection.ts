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
