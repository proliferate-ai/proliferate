import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(packageRoot, "src/qualification/assets");
const target = resolve(packageRoot, "dist/qualification/assets");
const cssSource = resolve(packageRoot, "src/qualification/product-client-canary.css");
const cssTarget = resolve(packageRoot, "dist/qualification/product-client-canary.css");

if (!existsSync(source)) {
  throw new Error(`Missing ProductClient qualification assets: ${source}`);
}

rmSync(target, { force: true, recursive: true });
mkdirSync(dirname(target), { recursive: true });
cpSync(source, target, { recursive: true });
copyFileSync(cssSource, cssTarget);
