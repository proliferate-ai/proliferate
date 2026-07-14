import { mkdir } from "node:fs/promises";

import { chromium, type Browser } from "playwright";

import type { MaterializedArtifact } from "../../artifacts/local-candidate-set.js";
import type { Exec } from "./docker.js";
import { launchRendererServer, type LaunchedProcess, type ReadinessFetch, type SpawnLike } from "./processes.js";

/**
 * Extracts and serves the exact Desktop renderer archive and launches the
 * shared Chromium browser via Playwright (spec "World startup" steps 8–9,
 * "productPage"). The renderer was built with THIS run's allocated
 * `VITE_PROLIFERATE_API_BASE_URL` and `VITE_ANYHARNESS_DEV_URL` (injected at
 * build time by the candidate builder), so serving the extracted bytes is all
 * the world does — no runtime URL rewriting.
 *
 * One `Browser` is shared by the world; each actor/scenario gets an isolated
 * `BrowserContext` (owned by the product-page fixture). We drive plain
 * `playwright` from our own runner — the `@playwright/test` runner is NOT
 * adopted; scenarios stay in the node:test/registry model.
 *
 * Archive layout contract: the candidate builder packs the CONTENTS of
 * `apps/desktop/dist` at the archive root (e.g. `tar -czf renderer.tar -C
 * apps/desktop/dist .`), so `index.html` lands directly under `destDir`.
 */

export interface ExtractedRenderer {
  /** Directory the archive was extracted into (run-owned). */
  rootDir: string;
  /** The renderer artifact identity (archive hash is its provable identity). */
  artifact: MaterializedArtifact;
}

/** Extracts the renderer dist archive into run-owned storage. */
export async function extractRenderer(
  artifact: MaterializedArtifact,
  destDir: string,
  deps: { exec?: Exec } = {},
): Promise<ExtractedRenderer> {
  const exec = deps.exec ?? defaultExec;
  await mkdir(destDir, { recursive: true });
  await exec("tar", ["-xf", artifact.path, "-C", destDir]);
  return { rootDir: destDir, artifact };
}

export interface ServedRenderer {
  baseUrl: string;
  process: LaunchedProcess;
}

/** Serves the extracted renderer bytes on the allocated port. */
export async function serveRenderer(params: {
  extracted: ExtractedRenderer;
  host: string;
  port: number;
  timeoutMs?: number;
  log?: (message: string) => void;
  spawn?: SpawnLike;
  fetch?: ReadinessFetch;
}): Promise<ServedRenderer> {
  const { process: served, baseUrl } = await launchRendererServer({
    rootDir: params.extracted.rootDir,
    host: params.host,
    port: params.port,
    timeoutMs: params.timeoutMs,
    log: params.log,
    spawn: params.spawn,
    fetch: params.fetch,
  });
  return { baseUrl, process: served };
}

/** Injectable Chromium launcher — real Playwright in production, fake in tests. */
export type ChromiumLauncher = (options: { headless: boolean }) => Promise<Browser>;

/**
 * Launches a single headless Chromium instance for the world. Callers create
 * per-actor isolated contexts against it; the world registers browser teardown.
 */
export async function launchChromium(options?: {
  headless?: boolean;
  log?: (message: string) => void;
  launcher?: ChromiumLauncher;
}): Promise<Browser> {
  const launcher = options?.launcher ?? ((opts) => chromium.launch(opts));
  const log = options?.log ?? (() => undefined);
  log("launching Chromium via Playwright");
  return launcher({ headless: options?.headless ?? true });
}

const defaultExec: Exec = async (file, args, execOptions) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const { stdout, stderr } = await run(file, [...args], {
    timeout: execOptions?.timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { stdout: stdout.toString(), stderr: stderr.toString() };
};
