#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_SDK_OPENAPI = path.join(
  REPO_ROOT,
  "anyharness",
  "sdk",
  "generated",
  "openapi.json",
);
const HTTP_METHODS = new Set(["delete", "get", "head", "options", "patch", "post", "put", "trace"]);

export function openApiOperations(document) {
  const operations = new Set();
  for (const [route, pathItem] of Object.entries(document?.paths ?? {})) {
    if (!pathItem || typeof pathItem !== "object") {
      continue;
    }
    for (const method of Object.keys(pathItem)) {
      if (HTTP_METHODS.has(method.toLowerCase())) {
        operations.add(`${method.toUpperCase()} ${route}`);
      }
    }
  }
  return operations;
}

export function assertCompatibleOpenApi(runtimeDocument, sdkDocument) {
  const runtimeOperations = openApiOperations(runtimeDocument);
  const sdkOperations = openApiOperations(sdkDocument);
  const missing = [...sdkOperations]
    .filter((operation) => !runtimeOperations.has(operation))
    .sort();

  if (missing.length > 0) {
    throw new Error(
      `AnyHarness binary is missing ${missing.length} SDK route(s):\n${missing
        .map((operation) => `  - ${operation}`)
        .join("\n")}`,
    );
  }

  try {
    assert.deepStrictEqual(runtimeDocument, sdkDocument);
  } catch {
    throw new Error(
      "AnyHarness binary OpenAPI differs from anyharness/sdk/generated/openapi.json; "
        + "rebuild the binary and regenerate the SDK from the same source revision.",
    );
  }
}

export async function verifyAnyharnessSdkCompatibility({
  binaryPath,
  sdkOpenApiPath = DEFAULT_SDK_OPENAPI,
  expectedVersion,
}) {
  const resolvedBinary = path.resolve(binaryPath);
  const runtimeResult = spawnSync(resolvedBinary, ["print-openapi"], {
    encoding: "utf8",
    env: operationalEnvironment(),
    maxBuffer: 32 * 1024 * 1024,
  });
  if (runtimeResult.error) {
    throw new Error(`Could not execute ${resolvedBinary}: ${runtimeResult.error.message}`);
  }
  if (runtimeResult.status !== 0) {
    throw new Error(
      `${resolvedBinary} print-openapi exited ${runtimeResult.status}: ${runtimeResult.stderr.trim()}`,
    );
  }

  let runtimeDocument;
  let sdkDocument;
  try {
    runtimeDocument = JSON.parse(runtimeResult.stdout);
  } catch (error) {
    throw new Error(
      `${resolvedBinary} print-openapi returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  try {
    sdkDocument = JSON.parse(await readFile(path.resolve(sdkOpenApiPath), "utf8"));
  } catch (error) {
    throw new Error(
      `Could not read SDK OpenAPI at ${path.resolve(sdkOpenApiPath)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  assertCompatibleOpenApi(runtimeDocument, sdkDocument);

  let version;
  if (expectedVersion) {
    const versionResult = spawnSync(resolvedBinary, ["--version"], {
      encoding: "utf8",
      env: operationalEnvironment(),
    });
    if (versionResult.error || versionResult.status !== 0) {
      throw new Error(
        `Could not read AnyHarness version from ${resolvedBinary}: ${
          versionResult.error?.message ?? versionResult.stderr.trim()
        }`,
      );
    }
    version = versionResult.stdout.trim().replace(/^anyharness\s+/, "");
    if (version !== expectedVersion) {
      throw new Error(
        `AnyHarness binary version "${version}" does not match expected version "${expectedVersion}".`,
      );
    }
  }

  return {
    binaryPath: resolvedBinary,
    operationCount: openApiOperations(runtimeDocument).size,
    version,
  };
}

function operationalEnvironment(source = process.env) {
  const result = {};
  for (const key of [
    "PATH",
    "Path",
    "SYSTEMROOT",
    "WINDIR",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "NO_COLOR",
  ]) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const binaryPath = argValue("--binary");
  if (!binaryPath) {
    throw new Error(
      "usage: verify-anyharness-sdk-compat --binary <path> "
        + "[--sdk-openapi <path>] [--expected-version <version>] [--quiet]",
    );
  }
  const proof = await verifyAnyharnessSdkCompatibility({
    binaryPath,
    sdkOpenApiPath: argValue("--sdk-openapi"),
    expectedVersion: argValue("--expected-version"),
  });
  if (!process.argv.includes("--quiet")) {
    const version = proof.version ? ` version=${proof.version}` : "";
    console.log(
      `AnyHarness/SDK compatible: ${proof.binaryPath}${version} operations=${proof.operationCount}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
