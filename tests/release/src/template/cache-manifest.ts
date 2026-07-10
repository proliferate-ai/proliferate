import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface TemplateCacheEntry {
  templateRef: string;
  builtAt: string;
  e2bTeamId: string;
}

export interface TemplateCacheManifest {
  /** hash -> cache entry. One manifest file per E2B team, since a template ref is not portable across teams. */
  entries: Record<string, TemplateCacheEntry>;
}

const DEFAULT_CACHE_DIR = path.resolve(import.meta.dirname, "../../.cache");

export function cacheManifestPath(cacheDir: string = DEFAULT_CACHE_DIR): string {
  return path.join(cacheDir, "template-manifest.json");
}

export async function loadCacheManifest(cacheDir: string = DEFAULT_CACHE_DIR): Promise<TemplateCacheManifest> {
  const filePath = cacheManifestPath(cacheDir);
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as TemplateCacheManifest;
  } catch (error) {
    if (isNotFound(error)) {
      return { entries: {} };
    }
    throw error;
  }
}

export async function lookupCachedTemplate(
  hash: string,
  e2bTeamId: string,
  cacheDir: string = DEFAULT_CACHE_DIR,
): Promise<TemplateCacheEntry | undefined> {
  const manifest = await loadCacheManifest(cacheDir);
  const entry = manifest.entries[hash];
  if (entry && entry.e2bTeamId === e2bTeamId) {
    return entry;
  }
  return undefined;
}

export async function recordCachedTemplate(
  hash: string,
  entry: TemplateCacheEntry,
  cacheDir: string = DEFAULT_CACHE_DIR,
): Promise<void> {
  const manifest = await loadCacheManifest(cacheDir);
  manifest.entries[hash] = entry;
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cacheManifestPath(cacheDir), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "ENOENT";
}
