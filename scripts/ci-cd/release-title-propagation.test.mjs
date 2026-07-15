import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("release coordinators pass the title into the desktop release lane", async () => {
  const [nightly, hotfix, promote, deployDesktop] = await Promise.all([
    workflow("nightly-release-train.yml"),
    workflow("hotfix-production.yml"),
    workflow("promote-production.yml"),
    workflow("_deploy-desktop.yml"),
  ]);

  for (const source of [nightly, hotfix, promote]) {
    assert.match(source, /workflow_dispatch:[\s\S]*?release_title:/);
    assert.match(
      source,
      /release_title: \$\{\{ github\.event\.inputs\.release_title \|\| '' \}\}/,
    );
  }

  assert.match(deployDesktop, /workflow_call:[\s\S]*?release_title:/);
  assert.match(deployDesktop, /release_title: \$\{\{ inputs\.release_title \}\}/);
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
