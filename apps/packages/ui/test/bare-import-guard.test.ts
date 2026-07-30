import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The root entries (`exports["."]`) on @proliferate/ui and
 * @proliferate/product-ui exist for EXTERNAL consumers (design tooling that
 * needs the package as one unit). Internal app code keeps AGENTS.md's
 * no-convenience-barrel rule: import the subpath that owns the symbol.
 */
const ROOTS = ["apps/packages", "apps/web/src", "apps/desktop/src", "apps/mobile/src"];
const BARE = /from\s+["']@proliferate\/(ui|product-ui)["']/;

function walk(dir: string, hits: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, hits);
    else if (/\.(ts|tsx)$/.test(name) && BARE.test(readFileSync(p, "utf8"))) hits.push(p);
  }
}

describe("bare package imports", () => {
  it("app code imports @proliferate/ui and product-ui by subpath, never the root barrel", () => {
    const repo = join(__dirname, "..", "..", "..", "..");
    const hits: string[] = [];
    for (const root of ROOTS) {
      try { walk(join(repo, root), hits); } catch { /* app dir may not exist */ }
    }
    expect(hits, `bare root-barrel imports (use the owning subpath):\n${hits.join("\n")}`).toEqual([]);
  });
});
