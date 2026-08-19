/**
 * Deterministic, non-React file-tree transport data for the file-viewer
 * qualification host. `main.tsx` owns provider/rendering assembly only; this
 * module owns every scripted AnyHarness `files/entries`, `files/search`, and
 * `files/stat` response the docked-tree fixture needs, plus the
 * scripted/unscripted request accounting the qualification spec asserts
 * against (spec "02A - Docked File Tree", "Tests and qualification").
 *
 * Deliberately data-only: no React, no DOM, no store access. Import this from
 * `main.tsx` and route matching `fetch` calls into it before falling through
 * to the file-reference-routing fixture's existing scripted responses.
 */

export type FixtureFileKind = "file" | "directory" | "symlink";

export interface FixtureFileEntry {
  hasChildren?: boolean | null;
  isText?: boolean | null;
  kind: FixtureFileKind;
  modifiedAt?: string | null;
  name: string;
  path: string;
  sizeBytes?: number | null;
}

const FIXED_TIME = "2026-08-19T12:00:00.000Z";

/**
 * The deterministic directory tree, keyed by parent path ("" is root).
 * `retry` produces one retryable (HTTP 500) response, then succeeds — the
 * fixture must track per-path attempt counts to reproduce that exactly once.
 * `terminal-error` always returns a terminal 4xx. `broken-link` is a listed
 * symlink whose stat resolves to an unexpected `kind: "symlink"`.
 */
const DIRECTORY_ENTRIES: Record<string, FixtureFileEntry[]> = {
  "": [
    { kind: "directory", name: "src", path: "src", hasChildren: true },
    { kind: "directory", name: "docs", path: "docs", hasChildren: true },
    { kind: "directory", name: "empty-dir", path: "empty-dir", hasChildren: false },
    { kind: "directory", name: "retry-dir", path: "retry-dir", hasChildren: true },
    { kind: "directory", name: "terminal-error-dir", path: "terminal-error-dir", hasChildren: true },
    {
      kind: "symlink",
      name: "broken-link",
      path: "broken-link",
      isText: null,
      sizeBytes: null,
    },
    {
      kind: "file",
      name: "README.md",
      path: "README.md",
      isText: true,
      sizeBytes: 42,
    },
  ],
  "src": [
    { kind: "file", name: "index.ts", path: "src/index.ts", isText: true, sizeBytes: 128 },
    { kind: "directory", name: "components", path: "src/components", hasChildren: true },
  ],
  "src/components": [
    {
      kind: "file",
      name: "Button.tsx",
      path: "src/components/Button.tsx",
      isText: true,
      sizeBytes: 256,
    },
    { kind: "directory", name: "nested", path: "src/components/nested", hasChildren: true },
  ],
  "src/components/nested": [
    { kind: "directory", name: "deep", path: "src/components/nested/deep", hasChildren: true },
  ],
  "src/components/nested/deep": [
    {
      kind: "directory",
      name: "very",
      path: "src/components/nested/deep/very",
      hasChildren: true,
    },
  ],
  "src/components/nested/deep/very": [
    {
      kind: "directory",
      name: "long",
      path: "src/components/nested/deep/very/long",
      hasChildren: true,
    },
  ],
  "src/components/nested/deep/very/long": [
    {
      kind: "file",
      name: "path.ts",
      path: "src/components/nested/deep/very/long/path.ts",
      isText: true,
      sizeBytes: 64,
    },
  ],
  "docs": [
    { kind: "file", name: "README.md", path: "docs/README.md", isText: true, sizeBytes: 512 },
  ],
  "empty-dir": [],
  "retry-dir": [
    { kind: "file", name: "settled.ts", path: "retry-dir/settled.ts", isText: true, sizeBytes: 16 },
  ],
};

/** Long selected-deep-file path used by the "selected deep file" screenshot case. */
export const FIXTURE_DEEP_FILE_PATH = "src/components/nested/deep/very/long/path.ts";
export const FIXTURE_TERMINAL_ERROR_DIR_PATH = "terminal-error-dir";
export const FIXTURE_RETRY_DIR_PATH = "retry-dir";
export const FIXTURE_BROKEN_SYMLINK_PATH = "broken-link";
export const FIXTURE_EMPTY_DIR_PATH = "empty-dir";

interface FileTreeFixtureCounters {
  scripted: number;
  unscripted: number;
}

export interface FileTreeFixture {
  /** Handles one AnyHarness request; returns null when the URL is unrecognized. */
  respond(url: URL): Response | null;
  counters(): FileTreeFixtureCounters;
  reset(): void;
}

/**
 * Builds a fresh deterministic transport for one fixture workspace. Every
 * scripted match increments `scripted`; the caller is responsible for
 * treating a null `respond()` result as unscripted (and failing the request)
 * so the qualification suite's "zero unscripted requests" assertion holds.
 */
export function createFileTreeFixture(workspaceId: string): FileTreeFixture {
  let scripted = 0;
  let unscripted = 0;
  const retryAttemptsByPath = new Map<string, number>();

  const workspacePrefix = `/v1/workspaces/${encodeURIComponent(workspaceId)}`;

  function json(value: unknown, status = 200): Response {
    scripted += 1;
    return new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  function respond(url: URL): Response | null {
    if (url.pathname === `${workspacePrefix}/files/entries`) {
      const path = url.searchParams.get("path") ?? "";
      return respondEntries(path);
    }
    if (url.pathname === `${workspacePrefix}/files/search`) {
      const query = (url.searchParams.get("q") ?? "").toLowerCase();
      const limit = Number(url.searchParams.get("limit") ?? "60");
      return respondSearch(query, limit);
    }
    if (url.pathname === `${workspacePrefix}/files/stat`) {
      const path = url.searchParams.get("path") ?? "";
      // Stat may be shared with a caller (e.g. the file-reference-routing
      // fixture) that owns paths outside this tree; only claim a stat
      // request for a path this deterministic tree actually knows about, so
      // an unrelated caller's fallback handler still runs for its own paths.
      if (!isKnownPath(path)) {
        return null;
      }
      return respondStat(path);
    }
    unscripted += 1;
    return null;
  }

  function isKnownPath(path: string): boolean {
    if (path === "" || path === FIXTURE_BROKEN_SYMLINK_PATH) {
      return true;
    }
    const parentPath = path.split("/").slice(0, -1).join("/");
    return DIRECTORY_ENTRIES[parentPath]?.some((entry) => entry.path === path) ?? false;
  }

  function respondEntries(path: string): Response {
    if (path === FIXTURE_TERMINAL_ERROR_DIR_PATH) {
      return json(
        { code: "FILE_PERMISSION_DENIED", message: "Refused." },
        403,
      );
    }
    if (path === FIXTURE_RETRY_DIR_PATH) {
      const attempts = (retryAttemptsByPath.get(path) ?? 0) + 1;
      retryAttemptsByPath.set(path, attempts);
      if (attempts === 1) {
        return json({ code: "INTERNAL", message: "Transient." }, 500);
      }
    }
    const entries = DIRECTORY_ENTRIES[path];
    if (entries === undefined) {
      return json({ code: "FILE_NOT_FOUND", message: "Not found." }, 404);
    }
    return json({ directoryPath: path, entries });
  }

  function respondSearch(query: string, limit: number): Response {
    const all = Object.values(DIRECTORY_ENTRIES)
      .flat()
      .filter((entry) => entry.kind === "file");
    const results = (query === "" ? all : all.filter((entry) => (
      entry.name.toLowerCase().includes(query) || entry.path.toLowerCase().includes(query)
    )))
      .slice(0, limit)
      .map((entry) => ({ name: entry.name, path: entry.path }));
    return json({ results });
  }

  function respondStat(path: string): Response {
    if (path === FIXTURE_BROKEN_SYMLINK_PATH) {
      // Unexpected stat kind: the runtime is contractually supposed to
      // resolve a symlink to `file`/`directory`; this fixture path proves
      // the fail-closed "unavailable, never inferred from size" behavior.
      return json({ kind: "symlink", path, modifiedAt: FIXED_TIME, sizeBytes: null });
    }
    if (path === "") {
      return json({ kind: "directory", path, modifiedAt: FIXED_TIME });
    }
    const parentPath = path.split("/").slice(0, -1).join("/");
    const entry = DIRECTORY_ENTRIES[parentPath]?.find((candidate) => candidate.path === path);
    if (!entry) {
      return json({ code: "FILE_NOT_FOUND", message: "Not found." }, 404);
    }
    return json({
      kind: entry.kind,
      path,
      isText: entry.isText ?? null,
      modifiedAt: FIXED_TIME,
      sizeBytes: entry.sizeBytes ?? null,
    });
  }

  return {
    respond,
    counters: () => ({ scripted, unscripted }),
    reset: () => {
      scripted = 0;
      unscripted = 0;
      retryAttemptsByPath.clear();
    },
  };
}
