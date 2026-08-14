#!/usr/bin/env node
/**
 * Evaluates the LIVE library registry and writes it to
 * `.out/.ds-registry-manifest.json` as `[{tierId, tierTitle, name, subpath}]`
 * in tier order.
 *
 * Why evaluate instead of parse: the registry is no longer four flat tier
 * files of literal `{name, subpath, render}` objects. Entries now live in
 * `library/entries/*.tsx` and kit files (`tabs.tsx`, `panel.tsx`), are spread
 * into the tier arrays, and tiers compose them by import — a regex over the
 * tier files can no longer see the whole set. `LIBRARY_TIERS` itself is the
 * only place the truth is assembled, so this compiles that module graph with
 * the same Vite machinery `build-bundle.mjs` uses (the `#product/` alias into
 * the live src tree, react deduped) and reads the tiers in-process.
 *
 * Renders are NOT executed: the dump only reads `tier.id`, `tier.title`,
 * `entry.name` and `entry.subpath`. The `render` closures are never called,
 * so nothing in the dump needs a DOM.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const PRODUCT_CLIENT_DIR = join(REPO_ROOT, "apps/packages/product-client");
const SRC_DIR = join(PRODUCT_CLIENT_DIR, "src");
const OUT_DIR = join(HERE, ".out");
const LIBRARY_INDEX = join(SRC_DIR, "components/playground/library/index.tsx");

/** The evaluated dump every other stage reads. */
export const REGISTRY_JSON_PATH = join(OUT_DIR, ".ds-registry-manifest.json");

// The compiled dump module is written INSIDE product-client's node_modules so
// that whatever Vite leaves external (react, radix, …) still resolves by plain
// Node resolution when this process imports it. Scratch only — deleted after
// the import.
const SCRATCH_DIR = join(PRODUCT_CLIENT_DIR, "node_modules/.ds-design-sync");

/**
 * Compiles-and-executes `LIBRARY_TIERS`, returning
 * `[{tierId, tierTitle, name, subpath}]` in tier order.
 */
export async function evaluateRegistry() {
  if (!existsSync(LIBRARY_INDEX)) {
    throw new Error(`dump-registry: library index not found at ${LIBRARY_INDEX}`);
  }

  const pcRequire = createRequire(join(PRODUCT_CLIENT_DIR, "package.json"));
  const { build } = await import(pathToFileURL(pcRequire.resolve("vite")).href);

  rmSync(SCRATCH_DIR, { recursive: true, force: true });
  mkdirSync(SCRATCH_DIR, { recursive: true });

  const entryPath = join(SCRATCH_DIR, "registry-dump-entry.ts");
  const entrySpecifier = LIBRARY_INDEX.replace(/\.tsx$/, "");
  writeFileSync(
    entryPath,
    `// AUTO-GENERATED scratch entry (scripts/design-sync/dump-registry.mjs).
import { LIBRARY_TIERS } from ${JSON.stringify(entrySpecifier)};

export const REGISTRY = LIBRARY_TIERS.flatMap((tier) =>
  tier.entries.map((entry) => ({
    tierId: tier.id,
    tierTitle: tier.title,
    name: entry.name,
    subpath: entry.subpath,
  })),
);
`,
    "utf8",
  );

  try {
    await build({
      configFile: false,
      root: PRODUCT_CLIENT_DIR,
      logLevel: "error",
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      resolve: {
        dedupe: ["react", "react-dom"],
        // Same alias build-bundle.mjs uses: `#product/*` would otherwise
        // resolve through package.json "imports" to a dist/ that isn't built.
        alias: [{ find: /^#product\//, replacement: `${SRC_DIR}/` }],
      },
      build: {
        outDir: SCRATCH_DIR,
        emptyOutDir: false,
        minify: false,
        sourcemap: false,
        write: true,
        ssr: entryPath,
        rollupOptions: {
          output: { format: "es", entryFileNames: "registry-dump.mjs" },
        },
      },
    });

    const dumpModulePath = join(SCRATCH_DIR, "registry-dump.mjs");
    if (!existsSync(dumpModulePath)) {
      throw new Error(`dump-registry: Vite produced no ${dumpModulePath}`);
    }
    const mod = await import(`${pathToFileURL(dumpModulePath).href}?t=${Date.now()}`);
    const registry = mod.REGISTRY;

    if (!Array.isArray(registry) || registry.length === 0) {
      throw new Error("dump-registry: evaluated registry is empty");
    }
    for (const entry of registry) {
      for (const key of ["tierId", "tierTitle", "name", "subpath"]) {
        if (typeof entry[key] !== "string" || entry[key].length === 0) {
          throw new Error(
            `dump-registry: entry missing "${key}": ${JSON.stringify(entry)}`,
          );
        }
      }
    }
    return registry;
  } finally {
    rmSync(SCRATCH_DIR, { recursive: true, force: true });
  }
}

/** Evaluates the registry and writes `.out/.ds-registry-manifest.json`. */
export async function dumpRegistry() {
  const registry = await evaluateRegistry();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(REGISTRY_JSON_PATH, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  return registry;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const registry = await dumpRegistry();
  const byTier = {};
  for (const entry of registry) byTier[entry.tierId] = (byTier[entry.tierId] ?? 0) + 1;
  console.log(`dump-registry: wrote ${REGISTRY_JSON_PATH} (${registry.length} entries)`);
  console.log("dump-registry: by tier:", byTier);
}
