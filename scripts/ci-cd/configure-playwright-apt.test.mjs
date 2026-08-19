import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_UBUNTU_URI,
  configurePlaywrightAptSource,
  normalizePlaywrightAptSource,
  RUNNER_MIRROR_URI,
} from "./configure-playwright-apt.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOWS_ROOT = join(REPO_ROOT, ".github", "workflows");
const WITH_DEPS_MARKER = "--with-deps";
const HELPER_COMMAND =
  'sudo "$(command -v node)" "$GITHUB_WORKSPACE/scripts/ci-cd/configure-playwright-apt.mjs"';

async function withTemporarySource(source, callback) {
  const directory = await mkdtemp(join(tmpdir(), "configure-playwright-apt-"));
  const sourcePath = join(directory, "ubuntu.sources");
  try {
    await writeFile(sourcePath, source, "utf8");
    await callback(sourcePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function workflowFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await workflowFiles(path)));
    } else if (entry.isFile() && /\.ya?ml$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files.sort();
}

function indentation(line) {
  return line.length - line.trimStart().length;
}

test("normalizes the known hosted-runner mirror without changing unrelated bytes", () => {
  const input = [
    "# runner-owned source",
    "Types: deb",
    `URIs: ${RUNNER_MIRROR_URI}  `,
    "Suites: noble noble-updates noble-backports",
    "Components: main universe restricted multiverse",
    "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg",
    "",
  ].join("\r\n");

  const normalized = normalizePlaywrightAptSource(input);

  assert.equal(normalized.changed, true);
  assert.equal(
    normalized.source,
    input.replace(RUNNER_MIRROR_URI, CANONICAL_UBUNTU_URI),
  );
});

test("accepts the canonical source without rewriting the file", async () => {
  const input = [
    "Types: deb",
    `URIs: ${CANONICAL_UBUNTU_URI}`,
    "Suites: noble noble-updates noble-backports",
    "Components: main universe restricted multiverse",
    "",
  ].join("\n");

  await withTemporarySource(input, async (sourcePath) => {
    const fixedTime = new Date("2000-01-01T00:00:00.000Z");
    await utimes(sourcePath, fixedTime, fixedTime);
    const before = await stat(sourcePath, { bigint: true });

    assert.equal(await configurePlaywrightAptSource(sourcePath), false);

    const after = await stat(sourcePath, { bigint: true });
    assert.equal(after.mtimeNs, before.mtimeNs);
    assert.equal(await readFile(sourcePath, "utf8"), input);
  });
});

test("rejects unknown source shapes without modifying the file", async (context) => {
  const cases = {
    missing: "Types: deb\nSuites: noble\n",
    duplicate: `URIs: ${RUNNER_MIRROR_URI}\nURIs: ${RUNNER_MIRROR_URI}\n`,
    mixed: `URIs: ${RUNNER_MIRROR_URI}\nURIs: ${CANONICAL_UBUNTU_URI}\n`,
    "multiple values": `URIs: ${RUNNER_MIRROR_URI} ${CANONICAL_UBUNTU_URI}\n`,
    unknown: "URIs: https://regional.example.invalid/ubuntu/\n",
  };

  for (const [name, input] of Object.entries(cases)) {
    await context.test(name, async () => {
      await withTemporarySource(input, async (sourcePath) => {
        await assert.rejects(configurePlaywrightAptSource(sourcePath));
        assert.equal(await readFile(sourcePath, "utf8"), input);
      });
    });
  }
});

test("guards every hosted Playwright dependency install in its own run block", async () => {
  const expectedCommandsByWorkflow = new Map([
    [
      ".github/workflows/ci.yml",
      [
        "pnpm exec playwright install --with-deps chromium",
        "pnpm --filter @proliferate/product-client exec playwright install --with-deps chromium webkit",
        "pnpm -C tests/intent exec playwright install --with-deps chromium",
      ],
    ],
    [
      ".github/workflows/intent-tests.yml",
      [
        "pnpm -C tests/intent exec playwright install --with-deps chromium",
        "pnpm -C tests/intent exec playwright install --with-deps chromium",
      ],
    ],
    [
      ".github/workflows/release-e2e.yml",
      ["pnpm -C tests/intent exec playwright install --with-deps chromium"],
    ],
    [
      ".github/workflows/self-host-smoke.yml",
      ["npx playwright install --with-deps chromium"],
    ],
  ]);
  const installs = [];
  const helpers = [];

  for (const path of await workflowFiles(WORKFLOWS_ROOT)) {
    const workflow = relative(REPO_ROOT, path);
    const lines = (await readFile(path, "utf8")).split("\n");
    for (const [index, line] of lines.entries()) {
      if (line.includes(WITH_DEPS_MARKER)) {
        installs.push({ workflow, index, line, lines });
      }
      if (line.trim() === HELPER_COMMAND) {
        helpers.push({ workflow, index });
      }
    }
  }

  assert.equal(installs.length, 7, "hosted --with-deps call-site census changed");
  assert.equal(helpers.length, 7, "each hosted --with-deps call needs one helper");
  assert.deepEqual(
    new Map(
      [...expectedCommandsByWorkflow.keys()].map((workflow) => [
        workflow,
        installs
          .filter((install) => install.workflow === workflow)
          .map((install) => install.line.trim())
          .sort(),
      ]),
    ),
    new Map(
      [...expectedCommandsByWorkflow].map(([workflow, commands]) => [
        workflow,
        [...commands].sort(),
      ]),
    ),
  );
  assert.deepEqual(
    new Set(installs.map((install) => install.workflow)),
    new Set(expectedCommandsByWorkflow.keys()),
  );

  for (const install of installs) {
    const { workflow, index, line, lines } = install;
    assert.equal(
      lines[index - 1]?.trim(),
      HELPER_COMMAND,
      `${workflow}:${index + 1} is not immediately guarded`,
    );
    assert.equal(
      indentation(lines[index - 1]),
      indentation(line),
      `${workflow}:${index + 1} helper is outside the install run block`,
    );

    let runLine = index - 2;
    while (runLine >= 0 && indentation(lines[runLine]) >= indentation(line)) {
      runLine -= 1;
    }
    assert.equal(
      lines[runLine]?.trim(),
      "run: |",
      `${workflow}:${index + 1} install is not in a guarded multiline run block`,
    );
  }
});
