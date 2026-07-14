// Deterministic, dependency-free post-build copy of the qualification canary's
// resource inputs into dist. Plain `tsc` emits JS/d.ts only and never copies
// resource files, so dist consumers (and served host builds that resolve through
// dist) would otherwise 404 on the canary's assets. Sorted traversal keeps the
// output stable across runs and machines.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDir = join(packageRoot, "src", "qualification", "assets");
const outputDir = join(packageRoot, "dist", "qualification", "assets");

if (!existsSync(sourceDir)) {
  console.error(`[copy-qualification-assets] missing source dir: ${sourceDir}`);
  process.exit(1);
}

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from).sort()) {
    const src = join(from, name);
    const dest = join(to, name);
    if (statSync(src).isDirectory()) {
      copyDir(src, dest);
    } else {
      copyFileSync(src, dest);
    }
  }
}

// Clean-copy so removed source assets do not linger in dist.
rmSync(outputDir, { recursive: true, force: true });
copyDir(sourceDir, outputDir);
console.log(`[copy-qualification-assets] copied qualification assets -> ${outputDir}`);
