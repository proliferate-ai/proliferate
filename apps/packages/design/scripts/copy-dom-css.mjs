import { copyFile, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceDir = resolve(root, "src/css");
const targetDir = resolve(root, "dist/css");

await mkdir(targetDir, { recursive: true });

for (const entry of await readdir(sourceDir)) {
  if (!entry.endsWith(".css")) {
    continue;
  }

  await copyFile(resolve(sourceDir, entry), resolve(targetDir, entry));
}
