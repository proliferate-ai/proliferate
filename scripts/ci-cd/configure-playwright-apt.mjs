#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const DEFAULT_UBUNTU_SOURCE_PATH =
  "/etc/apt/sources.list.d/ubuntu.sources";
export const RUNNER_MIRROR_URI =
  "mirror+file:/etc/apt/apt-mirrors.txt";
export const CANONICAL_UBUNTU_URI =
  "https://archive.ubuntu.com/ubuntu/";
const ARCHIVE_SUITES = "noble noble-updates noble-backports";
const SECURITY_SUITES = "noble-security";
const UBUNTU_COMPONENTS = "main universe restricted multiverse";
const UBUNTU_ARCHIVE_KEY =
  "/usr/share/keyrings/ubuntu-archive-keyring.gpg";
const CRITICAL_FIELDS = new Map(
  ["Types", "URIs", "Suites", "Components", "Signed-By"].map((name) => [
    name.toLowerCase(),
    name,
  ]),
);

function sourceLines(source) {
  if (source.replaceAll("\r\n", "").includes("\r")) {
    throw new Error("Ubuntu deb822 source uses an unsupported line ending");
  }

  return [...source.matchAll(/[^\r\n]*(?:\r\n|\n|$)/g)]
    .filter((match) => match[0].length > 0)
    .map((match) => {
      const raw = match[0];
      const endingLength = raw.endsWith("\r\n")
        ? 2
        : raw.endsWith("\n")
          ? 1
          : 0;
      return {
        start: match.index,
        text: endingLength === 0 ? raw : raw.slice(0, -endingLength),
      };
    });
}

function deb822Stanzas(source) {
  const stanzas = [];
  let current = null;
  for (const line of sourceLines(source)) {
    if (/^[ \t]*$/.test(line.text)) {
      current = null;
      continue;
    }
    if (line.text.startsWith("#")) {
      continue;
    }
    if (current === null) {
      current = [];
      stanzas.push(current);
    }
    current.push(line);
  }
  return stanzas;
}

function criticalFields(stanza, stanzaNumber) {
  const fields = new Map();

  for (const line of stanza) {
    if (line.text.startsWith("#")) {
      continue;
    }
    if (/^[ \t]/.test(line.text)) {
      throw new Error(
        `Ubuntu deb822 stanza ${stanzaNumber} has an unknown continuation line`,
      );
    }

    const parsed = /^([A-Za-z0-9][A-Za-z0-9-]*):([ \t]*)(.*?)([ \t]*)$/.exec(
      line.text,
    );
    if (!parsed) {
      throw new Error(
        `Ubuntu deb822 stanza ${stanzaNumber} has an unknown field shape`,
      );
    }

    const exactName = CRITICAL_FIELDS.get(parsed[1].toLowerCase());
    if (exactName && parsed[1] !== exactName) {
      throw new Error(
        `Ubuntu deb822 stanza ${stanzaNumber} has an unknown critical field shape`,
      );
    }
    if (!exactName) {
      throw new Error(
        `Ubuntu deb822 stanza ${stanzaNumber} has unknown field ${parsed[1]}`,
      );
    }
    if (fields.has(exactName)) {
      throw new Error(
        `Ubuntu deb822 stanza ${stanzaNumber} duplicates critical field ${exactName}`,
      );
    }

    const valueStart = line.start + parsed[1].length + 1 + parsed[2].length;
    fields.set(exactName, {
      value: parsed[3],
      valueStart,
      valueEnd: valueStart + parsed[3].length,
    });
  }

  for (const name of CRITICAL_FIELDS.values()) {
    if (!fields.has(name)) {
      throw new Error(
        `Ubuntu deb822 stanza ${stanzaNumber} is missing critical field ${name}`,
      );
    }
  }
  if (
    fields.get("Types").value !== "deb" ||
    fields.get("Components").value !== UBUNTU_COMPONENTS ||
    fields.get("Signed-By").value !== UBUNTU_ARCHIVE_KEY
  ) {
    throw new Error(
      `Ubuntu deb822 stanza ${stanzaNumber} has an unknown critical field value`,
    );
  }

  return fields;
}

export function normalizePlaywrightAptSource(source) {
  const stanzas = deb822Stanzas(source);
  if (stanzas.length !== 2) {
    throw new Error(
      `expected exactly two Ubuntu deb822 stanzas, found ${stanzas.length}`,
    );
  }

  const fields = stanzas.map((stanza, index) =>
    criticalFields(stanza, index + 1),
  );
  const suiteOwners = new Set(
    fields.map((stanza) => stanza.get("Suites").value),
  );
  if (
    suiteOwners.size !== 2 ||
    !suiteOwners.has(ARCHIVE_SUITES) ||
    !suiteOwners.has(SECURITY_SUITES)
  ) {
    throw new Error("Ubuntu deb822 stanzas do not own the expected suite sets");
  }

  const uriFields = fields.map((stanza) => stanza.get("URIs"));
  if (
    uriFields.some(
      (field) =>
        field.value !== RUNNER_MIRROR_URI &&
        field.value !== CANONICAL_UBUNTU_URI,
    )
  ) {
    throw new Error("Ubuntu deb822 URIs fields do not match a supported source");
  }
  const uriValues = new Set(uriFields.map((field) => field.value));
  if (uriValues.size !== 1) {
    throw new Error("Ubuntu deb822 URIs fields must use one uniform source");
  }
  if (uriFields[0].value === CANONICAL_UBUNTU_URI) {
    return { changed: false, source };
  }

  let normalized = source;
  for (const field of uriFields.sort(
    (left, right) => right.valueStart - left.valueStart,
  )) {
    normalized =
      normalized.slice(0, field.valueStart) +
      CANONICAL_UBUNTU_URI +
      normalized.slice(field.valueEnd);
  }
  return {
    changed: true,
    source: normalized,
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
