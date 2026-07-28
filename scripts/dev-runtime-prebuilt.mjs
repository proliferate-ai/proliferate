#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { verifyAnyharnessSdkCompatibility } from "./ci-cd/verify-anyharness-sdk-compat.mjs";

export async function installDevRuntimePrebuilt({
  binaryPath,
  destinationPath,
  sourceSha,
  version,
  sdkOpenApiPath,
}) {
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) {
    throw new Error(`--source-sha must be a lowercase 40-hex Git SHA, got "${sourceSha}"`);
  }
  if (!version?.trim()) {
    throw new Error("--version must be non-empty");
  }

  const source = path.resolve(binaryPath);
  const destination = path.resolve(destinationPath);
  const sourceStats = await stat(source).catch(() => null);
  if (!sourceStats?.isFile()) {
    throw new Error(`AnyHarness build output is not a regular file: ${source}`);
  }

  const proof = await verifyAnyharnessSdkCompatibility({
    binaryPath: source,
    sdkOpenApiPath,
    expectedVersion: version,
  });
  const sha256 = createHash("sha256").update(await readFile(source)).digest("hex");
  const destinationDir = path.dirname(destination);
  const binaryTemp = path.join(destinationDir, `.${path.basename(destination)}.${process.pid}.tmp`);
  const metadataPath = `${destination}.json`;
  const metadataTemp = `${metadataPath}.${process.pid}.tmp`;

  await mkdir(destinationDir, { recursive: true, mode: 0o700 });
  try {
    await copyFile(source, binaryTemp);
    await chmod(binaryTemp, 0o755);
    await writeFile(
      metadataTemp,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          sourceSha,
          version,
          sha256,
          sdkOperationCount: proof.operationCount,
          installedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    await rename(binaryTemp, destination);
    await rename(metadataTemp, metadataPath);
  } finally {
    await rm(binaryTemp, { force: true }).catch(() => undefined);
    await rm(metadataTemp, { force: true }).catch(() => undefined);
  }

  return { destination, metadataPath, sha256, version, sourceSha };
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const binaryPath = argValue("--binary");
  const destinationPath = argValue("--destination");
  const sourceSha = argValue("--source-sha");
  const version = argValue("--version");
  if (!binaryPath || !destinationPath || !sourceSha || !version) {
    throw new Error(
      "usage: dev-runtime-prebuilt --binary <path> --destination <path> "
        + "--source-sha <40-hex> --version <version> [--sdk-openapi <path>]",
    );
  }

  const installed = await installDevRuntimePrebuilt({
    binaryPath,
    destinationPath,
    sourceSha,
    version,
    sdkOpenApiPath: argValue("--sdk-openapi"),
  });
  console.log(
    `Installed compatible AnyHarness ${installed.version} at ${installed.destination} `
      + `(${installed.sha256.slice(0, 12)}…, source ${installed.sourceSha.slice(0, 12)}).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
