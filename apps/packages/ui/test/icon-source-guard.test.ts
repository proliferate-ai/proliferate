import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The design system is the only icon source for product code. lucide-react is
 * an implementation detail of @proliferate/ui: the icon set it has not drawn
 * in-house is re-exported (curated, collision-checked against the owned
 * glyphs) by `ui/src/icons/lucide.ts`, and everything else imports icons from
 * `@proliferate/ui/icons`. A direct `from "lucide-react"` outside
 * `apps/packages/ui` bypasses that curation — this guard walks every other
 * frontend source tree and fails on any reintroduction.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const SCANNED_SRC_DIRS = [
  "apps/packages/product-client/src",
  "apps/packages/product-domain/src",
  "apps/packages/product-surfaces/src",
  "apps/packages/product-ui/src",
  "apps/packages/design/src",
  "apps/web/src",
  "apps/desktop/src",
  "apps/mobile/src",
].map((dir) => path.join(REPO_ROOT, dir));

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

const SKIPPED_DIRS = new Set(["node_modules", "dist"]);

const LUCIDE_IMPORT_PATTERN = /from\s+["']lucide-react["']/;

function collectSourceFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) collectSourceFiles(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    out.push(full);
  }
}

describe("icon source guard", () => {
  it("no product source imports lucide-react directly (use @proliferate/ui/icons)", () => {
    const files: string[] = [];
    for (const dir of SCANNED_SRC_DIRS) {
      collectSourceFiles(dir, files);
    }
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (LUCIDE_IMPORT_PATTERN.test(line)) {
          violations.push(`${path.relative(REPO_ROOT, file)}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(
      violations,
      [
        "Direct lucide-react imports bypass the design system's icon set.",
        "Import the glyph from `@proliferate/ui/icons`; if it is missing there,",
        "add it to `apps/packages/ui/src/icons/lucide.ts` (only when no owned",
        "glyph of that name already exists) or draw it in an owned module.",
        "Violations:",
        ...violations,
      ].join("\n"),
    ).toEqual([]);
  });
});
