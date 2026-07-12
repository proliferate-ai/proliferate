import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { ENV_MANIFEST } from "./env-manifest.js";
import { RELEASE_POLICY_ENV } from "../runner/workflow-policy.js";
import { SCENARIOS } from "../scenarios/registry.js";

const RELEASE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CODE_EXTENSIONS = new Set([".ts", ".mjs", ".py", ".sh", ".yml", ".yaml"]);

test("environment manifest has unique names and covers every RELEASE_E2E_* code reference", () => {
  const declared = new Set<string>();
  for (const spec of ENV_MANIFEST) {
    assert.equal(declared.has(spec.name), false, `duplicate environment manifest entry: ${spec.name}`);
    declared.add(spec.name);
  }

  const referenced = new Set<string>();
  const files = [
    ...["src", "scripts", "upgrade"].flatMap((root) => codeFiles(path.join(RELEASE_ROOT, root))),
    ...codeFiles(path.join(REPO_ROOT, ".github", "workflows")),
    path.join(REPO_ROOT, "Makefile"),
  ];
  for (const filePath of files) {
    if (filePath.endsWith("env-manifest.ts")) {
      continue;
    }
    const contents = readFileSync(filePath, "utf8");
    for (const match of contents.matchAll(/\bRELEASE_E2E_[A-Z0-9_]+\b/g)) {
      referenced.add(match[0]);
    }
  }

  const missing = [...referenced].filter((name) => !declared.has(name)).sort();
  assert.deepEqual(missing, [], `RELEASE_E2E_* names missing from env-manifest.ts: ${missing.join(", ")}`);
});

test("every scenario requiredEnv name is declared by the environment manifest", () => {
  const declared = new Set(ENV_MANIFEST.map((spec) => spec.name));
  const missing = SCENARIOS.flatMap((scenario) =>
    [
      ...scenario.requiredEnv,
      ...Object.values(scenario.requiredEnvByLane ?? {}).flat(),
    ]
      .filter((name) => !declared.has(name))
      .map((name) => `${scenario.id}:${name}`),
  );
  assert.deepEqual(missing, []);
});

test("canonical environment reference includes every release runner variable", () => {
  const referencePath = path.join(REPO_ROOT, "specs", "developing", "reference", "env-vars.yaml");
  const canonicalNames = parseCanonicalEnvironmentNames(readFileSync(referencePath, "utf8"));
  const expected = [...ENV_MANIFEST.map((spec) => spec.name), RELEASE_POLICY_ENV];
  const missing = expected.filter((name) => !canonicalNames.has(name)).sort();

  assert.deepEqual(
    missing,
    [],
    `release runner names missing from specs/developing/reference/env-vars.yaml: ${missing.join(", ")}`,
  );
});

function parseCanonicalEnvironmentNames(contents: string): Set<string> {
  const names = new Set<string>();
  const entryPattern = /^- name:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))\s*(?:#.*)?$/gm;
  for (const match of contents.matchAll(entryPattern)) {
    const name = match[1] ?? match[2] ?? match[3];
    if (name !== undefined) {
      names.add(name);
    }
  }
  return names;
}

function codeFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...codeFiles(entryPath));
    } else if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }
  return files;
}
