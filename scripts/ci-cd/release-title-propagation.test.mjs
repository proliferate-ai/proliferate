import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const workflowRoot = new URL("../../.github/workflows/", import.meta.url);

async function workflow(name) {
  return readFile(new URL(name, workflowRoot), "utf8");
}

test("desktop release accepts and writes the optional release title", async () => {
  const source = await workflow("release-desktop.yml");

  assert.match(source, /workflow_dispatch:[\s\S]*?release_title:/);
  assert.match(source, /workflow_call:[\s\S]*?release_title:/);
  assert.match(source, /RELEASE_TITLE: \$\{\{ inputs\.release_title \|\| '' \}\}/);
  assert.match(source, /--notes "\$RELEASE_TITLE"/);
});

test("same-version desktop release runs share one non-cancelling concurrency lock", async () => {
  const source = await workflow("release-desktop.yml");
  const jobs = source.indexOf("\njobs:");
  const workflowConfiguration = source.slice(0, jobs);

  assert.match(
    workflowConfiguration,
    /concurrency:\s+group: release-desktop-\$\{\{ inputs\.version && format\('desktop-v\{0\}', inputs\.version\) \|\| github\.ref_name \}\}\s+cancel-in-progress: false/,
  );
});

test("the desktop title entrypoint survives the coordinator collapse", async () => {
  // The three release coordinators collapsed into one release.yml whose only
  // dispatch inputs are surfaces, skip_build, and ref, so a titled desktop
  // release is dispatched on release-desktop.yml itself. The reusable
  // pass-through must therefore stay intact.
  const [deployDesktop, release] = await Promise.all([
    workflow("_deploy-desktop.yml"),
    workflow("release.yml"),
  ]);

  assert.match(deployDesktop, /workflow_call:[\s\S]*?release_title:/);
  assert.match(deployDesktop, /release_title: \$\{\{ inputs\.release_title \}\}/);
  assert.match(
    release,
    /workflow_dispatch:[\s\S]*?surfaces:[\s\S]*?skip_build:[\s\S]*?ref:/,
  );

  const retired = ["nightly-release-train.yml", "hotfix-production.yml", "promote-production.yml"];
  const present = (await readdir(workflowRoot)).filter((name) => retired.includes(name));
  assert.deepEqual(present, []);
});

test("runtime production builds stamp both version and deterministic source SHA", async () => {
  const source = await workflow("release-runtime.yml");
  const resolveStep = source.slice(
    source.indexOf("- name: Resolve build version"),
    source.indexOf("- name: Install musl-tools"),
  );

  assert.match(resolveStep, /PROLIFERATE_BUILD_VERSION=/);
  assert.match(resolveStep, /PROLIFERATE_BUILD_SHA=\$\(git rev-parse HEAD\)/);

  const crossConfig = await readFile(new URL("../../Cross.toml", import.meta.url), "utf8");
  assert.match(
    crossConfig,
    /passthrough\s*=\s*\[[^\]]*"PROLIFERATE_BUILD_VERSION"[^\]]*"PROLIFERATE_BUILD_SHA"[^\]]*\]/,
  );
});

test("desktop updater publication fails closed before overwriting a released version", async () => {
  const [source, infra] = await Promise.all([
    workflow("release-desktop.yml"),
    readFile(new URL("../../apps/desktop/infra/main.tf", import.meta.url), "utf8"),
  ]);

  const preflight = source.indexOf("- name: Refuse an existing immutable updater manifest");
  const assetUpload = source.indexOf("- name: Upload desktop assets to S3");
  assert.ok(preflight >= 0 && preflight < assetUpload, "immutable preflight must run before asset upload");
  assert.match(
    source.slice(preflight, assetUpload),
    /head-object[\s\S]*?if \[\[ "\$head_error" != \*"\(404\)"\* \]\]; then[\s\S]*?exit 1/,
  );
  assert.match(infra, /"s3:GetObject"/);
});

test("desktop updater creates the immutable manifest before changing the rolling feed", async () => {
  const source = await workflow("release-desktop.yml");
  const publish = source.slice(source.indexOf("- name: Upload manifest to S3"));
  const immutableCreate = publish.indexOf("aws s3api put-object");
  const rollingUpload = publish.indexOf('"s3://${BUCKET}/desktop/stable/latest.json"');

  assert.ok(
    immutableCreate >= 0 && immutableCreate < rollingUpload,
    "immutable manifest creation must gate the rolling upload",
  );
  assert.match(
    publish.slice(immutableCreate, rollingUpload),
    /--body latest\.json[\s\S]*?--if-none-match "\*"[\s\S]*?then[\s\S]*?exit 1[\s\S]*?fi/,
  );
});
