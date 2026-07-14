import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

function parseArgs() {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    args.set(process.argv[index], process.argv[index + 1]);
  }
  return {
    dist: resolve(args.get("--dist") ?? "apps/web/dist"),
    out: resolve(args.get("--out") ?? "specs/codebase/features/web-desktop-product-client-web-baseline.json"),
  };
}

const { dist, out } = parseArgs();
const manifestPath = join(dist, ".vite", "manifest.json");
if (!existsSync(manifestPath)) {
  throw new Error(`Missing Vite manifest at ${manifestPath}. Build Web with manifest enabled before collecting.`);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const files = new Map();
for (const entry of Object.values(manifest)) {
  if (entry.file) files.set(entry.file, "js");
  for (const css of entry.css ?? []) files.set(css, "css");
  for (const asset of entry.assets ?? []) files.set(asset, asset.split(".").at(-1) ?? "asset");
}

const totals = {};
const entries = [];
for (const [file, kind] of [...files].sort()) {
  const bytes = readFileSync(join(dist, file));
  const gzipBytes = gzipSync(bytes).byteLength;
  totals[kind] = (totals[kind] ?? 0) + gzipBytes;
  entries.push({
    file,
    name: basename(file),
    kind,
    bytes: bytes.byteLength,
    gzipBytes,
  });
}

const baseline = {
  schemaVersion: 1,
  collectedAt: new Date().toISOString(),
  dist,
  metric: "gzip_bytes",
  note: "Provisional legacy Web baseline. The Web replacement PR reruns this on its exact base for the binding budget.",
  totals,
  entries,
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`Wrote Web bundle baseline to ${out}`);
