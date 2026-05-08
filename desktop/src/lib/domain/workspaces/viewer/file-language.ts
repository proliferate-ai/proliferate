export function inferWorkspaceFileLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const languages: Record<string, string> = {
    ts: "typescript",
    tsx: "typescriptreact",
    js: "javascript",
    jsx: "javascriptreact",
    rs: "rust",
    py: "python",
    go: "go",
    json: "json",
    toml: "toml",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    mdx: "markdown",
    css: "css",
    scss: "scss",
    html: "html",
    sql: "sql",
    sh: "shell",
    bash: "shell",
    xml: "xml",
    svg: "xml",
  };
  return languages[ext] ?? "plaintext";
}
