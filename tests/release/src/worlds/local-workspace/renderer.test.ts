import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { MaterializedArtifact } from "../../artifacts/local-candidate-set.js";
import type { Exec } from "./docker.js";
import type { ReadinessFetch, SpawnLike } from "./processes.js";
import { extractRenderer, launchChromium, serveRenderer, type ChromiumLauncher } from "./renderer.js";

const RENDERER_ARTIFACT: MaterializedArtifact = {
  artifact_id: "desktop-renderer/browser",
  version: "0.1.0",
  sha256: "c".repeat(64),
  path: "/run/artifacts/renderer.tar",
};

test("extractRenderer untars the archive into the run-owned dest and returns the identity", async () => {
  const destDir = path.join(await mkdtemp(path.join(os.tmpdir(), "renderer-extract-")), "renderer");
  try {
    const calls: string[][] = [];
    const exec: Exec = async (file, args) => {
      calls.push([file, ...args]);
      return { stdout: "", stderr: "" };
    };
    const extracted = await extractRenderer(RENDERER_ARTIFACT, destDir, { exec });
    assert.equal(extracted.rootDir, destDir);
    assert.equal(extracted.artifact.sha256, RENDERER_ARTIFACT.sha256);
    assert.deepEqual(calls[0], ["tar", "-xf", "/run/artifacts/renderer.tar", "-C", destDir]);
  } finally {
    await rm(path.dirname(destDir), { recursive: true, force: true });
  }
});

test("serveRenderer serves the extracted bytes and reports its base URL", async () => {
  const child = new EventEmitter() as unknown as ChildProcess;
  Object.assign(child, {
    pid: 1,
    exitCode: null,
    signalCode: null,
    stderr: new EventEmitter(),
    kill: () => true,
  });
  const spawn: SpawnLike = () => child;
  const fetch: ReadinessFetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  const served = await serveRenderer({
    extracted: { rootDir: "/run/renderer", artifact: RENDERER_ARTIFACT },
    host: "127.0.0.1",
    port: 6100,
    spawn,
    fetch,
  });
  assert.equal(served.baseUrl, "http://127.0.0.1:6100");
});

test("launchChromium delegates to the injected launcher", async () => {
  let launchedHeadless: boolean | undefined;
  const fakeBrowser = { close: async () => undefined } as unknown as Awaited<ReturnType<ChromiumLauncher>>;
  const launcher: ChromiumLauncher = async (options) => {
    launchedHeadless = options.headless;
    return fakeBrowser;
  };
  const browser = await launchChromium({ launcher });
  assert.equal(launchedHeadless, true);
  assert.equal(browser, fakeBrowser);
});
