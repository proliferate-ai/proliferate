type ClosedDirectoryVisualKind =
  | "directory"
  | "directory-config"
  | "directory-docs"
  | "directory-git"
  | "directory-images"
  | "directory-src"
  | "directory-test";

export type FileVisualKind =
  | ClosedDirectoryVisualKind
  | "directory-open"
  | "directory-config-open"
  | "directory-docs-open"
  | "directory-git-open"
  | "directory-images-open"
  | "directory-src-open"
  | "directory-test-open"
  | "biome"
  | "c"
  | "cpp"
  | "css"
  | "default"
  | "docker"
  | "document"
  | "editorconfig"
  | "env"
  | "eslint"
  | "git"
  | "go"
  | "go-mod"
  | "html"
  | "image"
  | "java"
  | "javascript"
  | "json"
  | "kotlin"
  | "license"
  | "lock"
  | "makefile"
  | "markdown"
  | "npm"
  | "php"
  | "pnpm"
  | "prettier"
  | "python"
  | "react"
  | "react-ts"
  | "readme"
  | "ruby"
  | "rust"
  | "sass"
  | "settings"
  | "shell"
  | "sql"
  | "svg"
  | "swift"
  | "table"
  | "test-js"
  | "test-jsx"
  | "test-ts"
  | "toml"
  | "tsconfig"
  | "typescript"
  | "typescript-def"
  | "xml"
  | "yaml"
  | "yarn";

export interface FileVisual {
  kind: FileVisualKind;
}

const DIRECTORY_VISUALS_BY_NAME: Readonly<Record<string, ClosedDirectoryVisualKind>> = {
  ".config": "directory-config",
  ".git": "directory-git",
  ".github": "directory",
  ".vscode": "directory-config",
  "__snapshots__": "directory-test",
  "__tests__": "directory-test",
  "config": "directory-config",
  "configs": "directory-config",
  "doc": "directory-docs",
  "docs": "directory-docs",
  "e2e": "directory-test",
  "icons": "directory-images",
  "image": "directory-images",
  "images": "directory-images",
  "img": "directory-images",
  "spec": "directory-test",
  "specs": "directory-test",
  "src": "directory-src",
  "src-tauri": "directory-src",
  "test": "directory-test",
  "tests": "directory-test",
};

const OPEN_DIRECTORY_VISUALS: Readonly<Record<ClosedDirectoryVisualKind, FileVisualKind>> = {
  "directory": "directory-open",
  "directory-config": "directory-config-open",
  "directory-docs": "directory-docs-open",
  "directory-git": "directory-git-open",
  "directory-images": "directory-images-open",
  "directory-src": "directory-src-open",
  "directory-test": "directory-test-open",
};

const FILE_VISUALS_BY_NAME: Readonly<Record<string, FileVisualKind>> = {
  ".bash_profile": "shell",
  ".bashrc": "shell",
  ".dockerignore": "docker",
  ".editorconfig": "editorconfig",
  ".gitattributes": "git",
  ".gitignore": "git",
  ".gitkeep": "git",
  ".gitmodules": "git",
  ".npmignore": "npm",
  ".npmrc": "npm",
  ".pnpmfile.cjs": "pnpm",
  ".pnpmfile.js": "pnpm",
  ".prettierignore": "prettier",
  ".python-version": "python",
  ".ruby-version": "ruby",
  ".yarnrc": "yarn",
  ".yarnrc.yml": "yarn",
  ".zprofile": "shell",
  ".zshrc": "shell",
  "bun.lock": "lock",
  "bun.lockb": "lock",
  "cargo.lock": "lock",
  "cargo.toml": "rust",
  "compose.yaml": "docker",
  "compose.yml": "docker",
  "composer.json": "php",
  "composer.lock": "php",
  "containerfile": "docker",
  "dockerfile": "docker",
  "gemfile": "ruby",
  "go.mod": "go-mod",
  "go.sum": "go-mod",
  "gnumakefile": "makefile",
  "justfile": "makefile",
  "makefile": "makefile",
  "package-lock.json": "npm",
  "package.json": "npm",
  "pnpm-lock.yaml": "pnpm",
  "pnpm-workspace.yaml": "pnpm",
  "poetry.lock": "python",
  "procfile": "shell",
  "pyproject.toml": "python",
  "rakefile": "ruby",
  "requirements.txt": "python",
  "uv.lock": "lock",
  "yarn.lock": "yarn",
};

const FILE_VISUALS_BY_EXTENSION: Readonly<Record<string, FileVisualKind>> = {
  "avif": "image",
  "bash": "shell",
  "bmp": "image",
  "c": "c",
  "cc": "cpp",
  "cfg": "settings",
  "conf": "settings",
  "cpp": "cpp",
  "css": "css",
  "cts": "typescript",
  "csv": "table",
  "cxx": "cpp",
  "fish": "shell",
  "gif": "image",
  "go": "go",
  "h": "c",
  "hpp": "cpp",
  "htm": "html",
  "html": "html",
  "ico": "image",
  "ini": "settings",
  "java": "java",
  "jpeg": "image",
  "jpg": "image",
  "js": "javascript",
  "json": "json",
  "jsonc": "json",
  "jsx": "react",
  "kt": "kotlin",
  "kts": "kotlin",
  "md": "markdown",
  "mdx": "markdown",
  "mjs": "javascript",
  "mts": "typescript",
  "php": "php",
  "png": "image",
  "py": "python",
  "rb": "ruby",
  "rs": "rust",
  "rst": "document",
  "sass": "sass",
  "scss": "sass",
  "sh": "shell",
  "sql": "sql",
  "svg": "svg",
  "swift": "swift",
  "toml": "toml",
  "ts": "typescript",
  "tsv": "table",
  "tsx": "react-ts",
  "txt": "document",
  "webp": "image",
  "xml": "xml",
  "yaml": "yaml",
  "yml": "yaml",
  "zsh": "shell",
};

const FILE_VISUAL_PATTERNS: ReadonlyArray<readonly [pattern: RegExp, kind: FileVisualKind]> = [
  [/^\.env(?:\..+)?$/, "env"],
  [/^readme(?:\.[^.]+)?$/, "readme"],
  [/^(?:license|licence|copying)(?:\.[^.]+)?$/, "license"],
  [/^tsconfig(?:\..+)?\.json$/, "tsconfig"],
  [/^biome(?:\.jsonc?)$/, "biome"],
  [/^eslint\.config\.(?:[cm]?js|[cm]?ts)$/, "eslint"],
  [/^\.eslintrc(?:\.(?:[cm]?js|json|ya?ml|[cm]?ts))?$/, "eslint"],
  [/^prettier\.config\.(?:[cm]?js|[cm]?ts)$/, "prettier"],
  [/^\.prettierrc(?:\.(?:[cm]?js|json|ya?ml|toml|[cm]?ts))?$/, "prettier"],
  [/^(?:docker-compose|compose)(?:\.[^.]+)?\.ya?ml$/, "docker"],
  [/^(?:vite|vitest|webpack|rollup|babel|postcss|tailwind)\.config\.(?:[cm]?js|[cm]?ts)$/, "settings"],
  [/\.(?:test|spec)\.tsx$/, "test-jsx"],
  [/\.(?:test|spec)\.jsx$/, "test-jsx"],
  [/\.(?:test|spec)\.ts$/, "test-ts"],
  [/\.(?:test|spec)\.[cm]?js$/, "test-js"],
  [/\.d\.ts$/, "typescript-def"],
];

function getExtension(name: string): string {
  const parts = name.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() ?? "" : "";
}

function getDirectoryVisual(name: string): FileVisual {
  return {
    kind: DIRECTORY_VISUALS_BY_NAME[name] ?? "directory",
  };
}

function getPatternVisual(name: string): FileVisualKind | null {
  for (const [pattern, kind] of FILE_VISUAL_PATTERNS) {
    if (pattern.test(name)) {
      return kind;
    }
  }

  return null;
}

export function getFileVisual(
  name: string,
  _path: string,
  kind: string,
): FileVisual {
  const lowerName = name.toLowerCase();

  if (kind === "directory") {
    return getDirectoryVisual(lowerName);
  }

  const exactVisual = FILE_VISUALS_BY_NAME[lowerName];
  if (exactVisual) {
    return { kind: exactVisual };
  }

  const patternVisual = getPatternVisual(lowerName);
  if (patternVisual) {
    return { kind: patternVisual };
  }

  const ext = getExtension(lowerName);
  const extensionVisual = FILE_VISUALS_BY_EXTENSION[ext];
  if (extensionVisual) {
    return { kind: extensionVisual };
  }

  return { kind: "default" };
}

export function getExpandedFileVisualKind(kind: FileVisualKind): FileVisualKind {
  return OPEN_DIRECTORY_VISUALS[kind as ClosedDirectoryVisualKind] ?? kind;
}
