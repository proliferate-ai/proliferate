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
const CARGO_APT_UPDATE_COMMAND = "sudo apt-get update";
const CARGO_APT_INSTALL_COMMAND =
  "sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf";
const HOSTED_TWO_STANZA_SOURCE = [
  "# Hosted runner Ubuntu source configuration",
  `# The mirror indirection remains documented as ${RUNNER_MIRROR_URI}`,
  "",
  "Types: deb",
  `URIs: ${RUNNER_MIRROR_URI}`,
  "Suites: noble noble-updates noble-backports",
  "Components: main universe restricted multiverse",
  "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg",
  "",
  "Types: deb",
  `URIs: ${RUNNER_MIRROR_URI}`,
  "Suites: noble-security",
  "Components: main universe restricted multiverse",
  "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg",
  "",
].join("\n");

function twoStanzaSource({
  archiveUri = RUNNER_MIRROR_URI,
  securityUri = RUNNER_MIRROR_URI,
  owners = ["archive", "security"],
  lineEnding = "\n",
  includeComments = false,
} = {}) {
  const stanzaByOwner = {
    archive: {
      uri: archiveUri,
      suites: "noble noble-updates noble-backports",
    },
    security: {
      uri: securityUri,
      suites: "noble-security",
    },
  };
  const stanzas = owners.map((owner) => {
    const stanza = stanzaByOwner[owner];
    return [
      ...(includeComments ? [`# ${owner} suite owner`] : []),
      "Types: deb",
      `URIs: ${stanza.uri}`,
      `Suites: ${stanza.suites}`,
      "Components: main universe restricted multiverse",
      "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg",
    ].join(lineEnding);
  });
  return `${stanzas.join(`${lineEnding}${lineEnding}`)}${lineEnding}`;
}

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

test("normalizes both hosted archive and security mirror stanzas", async () => {
  const expected = HOSTED_TWO_STANZA_SOURCE.replaceAll(
    `URIs: ${RUNNER_MIRROR_URI}`,
    `URIs: ${CANONICAL_UBUNTU_URI}`,
  );
  const normalized = normalizePlaywrightAptSource(HOSTED_TWO_STANZA_SOURCE);

  assert.equal(normalized.changed, true);
  assert.equal(normalized.source, expected);

  await withTemporarySource(HOSTED_TWO_STANZA_SOURCE, async (sourcePath) => {
    assert.equal(await configurePlaywrightAptSource(sourcePath), true);
    assert.equal(await readFile(sourcePath, "utf8"), expected);
  });
});

test("preserves comments, critical fields, CRLF bytes, and reversed stanza order", () => {
  const input = twoStanzaSource({
    owners: ["security", "archive"],
    lineEnding: "\r\n",
    includeComments: true,
  });

  const normalized = normalizePlaywrightAptSource(input);

  assert.equal(normalized.changed, true);
  assert.equal(
    normalized.source,
    input.replaceAll(RUNNER_MIRROR_URI, CANONICAL_UBUNTU_URI),
  );
});

test("accepts both canonical stanzas without rewriting the file", async () => {
  const input = twoStanzaSource({
    archiveUri: CANONICAL_UBUNTU_URI,
    securityUri: CANONICAL_UBUNTU_URI,
  });

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

test("rejects unknown two-stanza shapes without modifying the file", async (context) => {
  const cases = {
    "missing security stanza": twoStanzaSource({ owners: ["archive"] }),
    "extra Ubuntu stanza": twoStanzaSource({
      owners: ["archive", "security", "archive"],
    }),
    "duplicate archive suite owner": twoStanzaSource({
      owners: ["archive", "archive"],
    }),
    "unexpected suite ownership": HOSTED_TWO_STANZA_SOURCE.replace(
      "Suites: noble-security",
      "Suites: noble-security noble-updates",
    ),
    "mirror plus canonical": twoStanzaSource({
      securityUri: CANONICAL_UBUNTU_URI,
    }),
    "multiple URI values": twoStanzaSource({
      archiveUri: `${RUNNER_MIRROR_URI} ${CANONICAL_UBUNTU_URI}`,
    }),
    "unknown URI": twoStanzaSource({
      securityUri: "https://regional.example.invalid/ubuntu/",
    }),
    "unknown Types value": HOSTED_TWO_STANZA_SOURCE.replace(
      "Types: deb",
      "Types: deb deb-src",
    ),
    "unknown Components value": HOSTED_TWO_STANZA_SOURCE.replace(
      "Components: main universe restricted multiverse",
      "Components: main universe",
    ),
    "unknown Signed-By value": HOSTED_TWO_STANZA_SOURCE.replace(
      "/usr/share/keyrings/ubuntu-archive-keyring.gpg",
      "/tmp/unknown-key.gpg",
    ),
    "missing critical field": HOSTED_TWO_STANZA_SOURCE.replace(
      "Components: main universe restricted multiverse\n",
      "",
    ),
    "duplicate critical field": HOSTED_TWO_STANZA_SOURCE.replace(
      "Types: deb\n",
      "Types: deb\nTypes: deb\n",
    ),
    "folded critical field": HOSTED_TWO_STANZA_SOURCE.replace(
      "Suites: noble-security",
      "Suites: noble-security\n noble-updates",
    ),
    "unknown critical field casing": HOSTED_TWO_STANZA_SOURCE.replace(
      "Signed-By:",
      "Signed-by:",
    ),
    "extra Enabled field": HOSTED_TWO_STANZA_SOURCE.replace(
      "Types: deb\n",
      "Enabled: no\nTypes: deb\n",
    ),
    "extra Architectures field": HOSTED_TWO_STANZA_SOURCE.replace(
      "Types: deb\n",
      "Types: deb\nArchitectures: arm64\n",
    ),
    "orphan continuation": HOSTED_TWO_STANZA_SOURCE.replace(
      "Types: deb\n",
      " unexpected\nTypes: deb\n",
    ),
  };

  for (const [name, input] of Object.entries(cases)) {
    await context.test(name, async () => {
      await withTemporarySource(input, async (sourcePath) => {
        const fixedTime = new Date("2000-01-01T00:00:00.000Z");
        await utimes(sourcePath, fixedTime, fixedTime);
        const before = await stat(sourcePath, { bigint: true });

        await assert.rejects(configurePlaywrightAptSource(sourcePath));

        const after = await stat(sourcePath, { bigint: true });
        assert.equal(after.mtimeNs, before.mtimeNs);
        assert.equal(await readFile(sourcePath, "utf8"), input);
      });
    });
  }
});

test("guards every hosted Playwright dependency install in its own run block", async () => {
  const expectedCommandsByWorkflow = new Map([
    // The 2026-08 CI cull deleted the other hosted browser-installing lanes
    // (the intent suite, the dispatch-only heavy lanes, and release-e2e.yml's
    // tier-2 job); this smoke lane is the one hosted --with-deps call-site left.
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

  assert.equal(installs.length, 1, "hosted --with-deps call-site census changed");
  assert.equal(
    helpers.length,
    2,
    "one hosted --with-deps call and Cargo need one helper each",
  );
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

test("guards Cargo Tauri apt dependencies before the unchanged install commands", async () => {
  const path = join(WORKFLOWS_ROOT, "ci.yml");
  const lines = (await readFile(path, "utf8")).split("\n");
  const cargoJobs = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line === "  cargo-check:");
  const tauriSteps = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trim() === "- name: Install system deps (Tauri)");

  assert.equal(cargoJobs.length, 1, "expected exactly one cargo-check job");
  assert.equal(tauriSteps.length, 1, "expected exactly one Tauri dependency step");

  const [{ index: cargoJobIndex }] = cargoJobs;
  const [{ index: tauriStepIndex }] = tauriSteps;
  const nextJobIndex = lines.findIndex(
    (line, index) => index > cargoJobIndex && /^  [a-z0-9-]+:$/.test(line),
  );
  assert.ok(tauriStepIndex > cargoJobIndex, "Tauri step is outside cargo-check");
  assert.ok(
    nextJobIndex === -1 || tauriStepIndex < nextJobIndex,
    "Tauri step is outside cargo-check",
  );
  assert.equal(lines[tauriStepIndex + 1]?.trim(), "run: |");
  assert.deepEqual(
    lines.slice(tauriStepIndex + 2, tauriStepIndex + 5).map((line) => line.trim()),
    [HELPER_COMMAND, CARGO_APT_UPDATE_COMMAND, CARGO_APT_INSTALL_COMMAND],
  );
  assert.equal(indentation(lines[tauriStepIndex + 2]), 10);
  assert.equal(indentation(lines[tauriStepIndex + 3]), 10);
  assert.equal(indentation(lines[tauriStepIndex + 4]), 10);
});
