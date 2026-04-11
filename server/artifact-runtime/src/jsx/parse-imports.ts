const IMPORT_RE = /^\s*import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["'];?/gm;

export function parseImports(source: string): string[] {
  const modules = new Set<string>();
  for (const match of source.matchAll(IMPORT_RE)) {
    const moduleName = match[1]?.trim();
    if (moduleName) {
      modules.add(moduleName);
    }
  }
  return Array.from(modules);
}
