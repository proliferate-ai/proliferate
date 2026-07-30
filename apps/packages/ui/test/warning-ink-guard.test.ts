import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `--color-warning` is a FILL (rgba(255,180,50,0.15) dark / #fff8e6 light),
 * not an ink. Text or icons classed `text-warning` render as a translucent
 * wash instead of readable amber. The ink token is
 * `--color-warning-foreground` (`text-warning-foreground`); the purpose-built
 * surface/border tokens are `bg-warning-subtle` and `border-warning-border`.
 *
 * This guard walks the ui, product-ui, and product-client sources and fails
 * on any reintroduction of `text-warning` as a utility class.
 */

const PACKAGES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SCANNED_SRC_DIRS = ["ui", "product-ui", "product-client"].map((pkg) =>
  path.join(PACKAGES_ROOT, pkg, "src"),
);

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css"]);

const SKIPPED_DIRS = new Set(["node_modules", "dist"]);

// `text-warning` preceded by start-of-line, whitespace, or a quote, and not
// followed by more token name (so `text-warning-foreground` stays legal).
const WARNING_INK_PATTERN = /(?:^|[\s"'`])text-warning(?![-a-z])/;

function isTestFile(name: string): boolean {
  return name.includes(".test.") || name.includes(".spec.");
}

function collectSourceFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) collectSourceFiles(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    if (isTestFile(entry.name)) continue;
    out.push(full);
  }
}

describe("warning ink guard", () => {
  it("no source uses the warning fill token as ink (text-warning)", () => {
    const files: string[] = [];
    for (const dir of SCANNED_SRC_DIRS) {
      collectSourceFiles(dir, files);
    }
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (WARNING_INK_PATTERN.test(line)) {
          violations.push(`${path.relative(PACKAGES_ROOT, file)}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(
      violations,
      [
        "`text-warning` uses the warning FILL token as ink. `--color-warning` is a",
        "translucent surface fill, so this renders unreadable washed-out text.",
        "Use `text-warning-foreground` for warning text/icons, `bg-warning-subtle`",
        "for warning surfaces, and `border-warning-border` for warning borders.",
        "Violations:",
        ...violations,
      ].join("\n"),
    ).toEqual([]);
  });
});
