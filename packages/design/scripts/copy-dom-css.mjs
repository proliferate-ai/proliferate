import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const source = resolve(root, "src/dom.css");
const target = resolve(root, "dist/dom.css");

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
