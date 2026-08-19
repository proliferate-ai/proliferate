#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const DEFAULT_UBUNTU_SOURCE_PATH =
  "/etc/apt/sources.list.d/ubuntu.sources";
export const RUNNER_MIRROR_URI =
  "mirror+file:/etc/apt/apt-mirrors.txt";
export const CANONICAL_UBUNTU_URI =
  "https://archive.ubuntu.com/ubuntu/";

export function normalizePlaywrightAptSource(source) {
  const uriFields = [...source.matchAll(/^URIs:[^\r\n]*(?=\r?$)/gm)];
  if (uriFields.length !== 1) {
    throw new Error(
      `expected exactly one Ubuntu deb822 URIs field, found ${uriFields.length}`,
    );
  }

  const field = uriFields[0];
  const parsed = /^(URIs:[ \t]+)(\S+)([ \t]*)$/.exec(field[0]);
  if (!parsed) {
    throw new Error("expected the Ubuntu deb822 URIs field to contain one URI");
  }

  const uri = parsed[2];
  if (uri === CANONICAL_UBUNTU_URI) {
    return { changed: false, source };
  }
  if (uri !== RUNNER_MIRROR_URI) {
    throw new Error("Ubuntu deb822 URIs field does not match a supported source");
  }

  const uriStart = field.index + parsed[1].length;
  return {
    changed: true,
    source:
      source.slice(0, uriStart) +
      CANONICAL_UBUNTU_URI +
      source.slice(uriStart + RUNNER_MIRROR_URI.length),
  };
}

export async function configurePlaywrightAptSource(
  sourcePath = DEFAULT_UBUNTU_SOURCE_PATH,
) {
  const current = await readFile(sourcePath, "utf8");
  const normalized = normalizePlaywrightAptSource(current);
  if (normalized.changed) {
    await writeFile(sourcePath, normalized.source, "utf8");
  }
  return normalized.changed;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1) {
    throw new Error("usage: configure-playwright-apt.mjs [ubuntu.sources]");
  }

  const sourcePath = args[0] || DEFAULT_UBUNTU_SOURCE_PATH;
  const changed = await configurePlaywrightAptSource(sourcePath);
  console.log(
    changed
      ? "configure-playwright-apt: normalized hosted Ubuntu source"
      : "configure-playwright-apt: hosted Ubuntu source already canonical",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`configure-playwright-apt: ${message.slice(0, 500)}`);
    process.exitCode = 1;
  });
}
