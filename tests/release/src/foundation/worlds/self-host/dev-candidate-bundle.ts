/**
 * Local, self-host-only candidate bundle resolver.
 *
 * The shared candidate-artifact pipeline (build once per content hash, upload,
 * verify by digest — `release-worlds-and-fixtures.md` "Candidate Artifacts")
 * is owned by a sibling workstream and is not yet merged into this branch.
 * This module is an explicit, narrow stand-in scoped to exactly the slot the
 * self-host world needs (`CandidateManifest.selfHostBundle`): it builds the
 * real production server image from the exact checked-out source tree (the
 * same Dockerfile and build context `self-host-smoke.yml` uses), saves it,
 * and hashes the saved bytes. The resulting `ArtifactLocator` carries an
 * honest, verifiable, non-rolling digest — never `stable` or `latest` — but
 * it is a LOCAL artifact (a file on this machine), not an uploaded,
 * team-shared one. Recorded as a known gap in the workstream handoff: once
 * the shared pipeline lands, this resolver should be deleted in favor of the
 * real candidate-manifest loader.
 *
 * Every other candidate slot is left explicitly `unavailable` — this
 * resolver has no opinion on Desktop, Web, AnyHarness, or E2B artifacts; the
 * self-host world does not need them.
 */

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ArtifactLocator, CandidateManifest, Slot } from "../../contracts/artifacts.js";

function unavailable(reason: string): Slot<never> {
  return { available: false, reason };
}

export interface DevSelfHostBundle {
  /** Local image tag, e.g. "proliferate-server:candidate-<shortsha>". */
  readonly imageTag: string;
  /** Local path to the saved (gzipped) image tarball. */
  readonly tarPath: string;
  readonly locator: ArtifactLocator;
}

export interface BuildDevSelfHostBundleOptions {
  readonly repoRoot: string;
  readonly sourceSha: string;
  /** Docker build platform; must match the target EC2 instance's architecture. */
  readonly platform: "linux/arm64" | "linux/amd64";
  readonly workDir?: string;
  readonly log?: (line: string) => void;
}

/**
 * Builds the real server image from `repoRoot` at `sourceSha`'s working tree
 * (no registry push, no rolling tag), saves it to a gzipped tarball, and
 * returns its sha256 digest + size as a `ArtifactLocator`. Slow (real docker
 * build) — callers should only invoke this from the live vertical-slice
 * entrypoint, never from a unit test.
 */
export async function buildDevSelfHostBundle(options: BuildDevSelfHostBundleOptions): Promise<DevSelfHostBundle> {
  const shortSha = options.sourceSha.slice(0, 12);
  const imageTag = `proliferate-server:candidate-${shortSha}`;
  const log = options.log ?? (() => {});

  log(`docker build --platform ${options.platform} -f server/Dockerfile -t ${imageTag} .`);
  await run("docker", ["build", "--platform", options.platform, "-f", "server/Dockerfile", "-t", imageTag, "."], {
    cwd: options.repoRoot,
    onLine: log,
  });

  const workDir = options.workDir ?? join(tmpdir(), "proliferate-selfhost-e2e");
  await mkdir(workDir, { recursive: true });
  const tarPath = join(workDir, `${imageTag.replace(/[/:]/g, "_")}.tar`);

  log(`docker save ${imageTag} -o ${tarPath}`);
  await run("docker", ["save", imageTag, "-o", tarPath], { cwd: options.repoRoot, onLine: log });

  const digest = await sha256File(tarPath);
  const { size } = await stat(tarPath);

  return {
    imageTag,
    tarPath,
    locator: {
      locator: tarPath,
      digest,
      algorithm: "sha256",
      sizeBytes: size,
    },
  };
}

/** A CandidateManifest with only `selfHostBundle` populated; every other slot unavailable. */
export function selfHostOnlyCandidateManifest(params: {
  sourceSha: string;
  sourceContentHash: string;
  selfHostBundle: ArtifactLocator;
}): CandidateManifest {
  return {
    schemaVersion: 1,
    kind: "candidate",
    sourceSha: params.sourceSha,
    sourceContentHash: params.sourceContentHash,
    serverImage: unavailable("self-host-only dev resolver: server image slot not populated"),
    webBuild: unavailable("self-host-only dev resolver: web build slot not populated"),
    desktopApp: unavailable("self-host-only dev resolver: desktop app slot not populated"),
    desktopUpdater: unavailable("self-host-only dev resolver: desktop updater slot not populated"),
    anyharness: {},
    worker: {},
    supervisor: {},
    catalogHash: unavailable("self-host-only dev resolver: catalog hash slot not populated"),
    registryHash: unavailable("self-host-only dev resolver: registry hash slot not populated"),
    e2bTemplate: unavailable("self-host-only dev resolver: e2b template slot not populated"),
    selfHostBundle: { available: true, value: params.selfHostBundle },
    litellm: unavailable("self-host-only dev resolver: litellm slot not populated"),
  };
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const { createReadStream } = await import("node:fs");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolvePromise());
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

function run(cmd: string, args: string[], opts: { cwd: string; onLine: (line: string) => void }): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    const forward = (buf: Buffer) => {
      for (const line of buf.toString().split("\n")) {
        if (line.trim().length > 0) opts.onLine(line);
      }
    };
    child.stdout?.on("data", forward);
    child.stderr?.on("data", forward);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`));
    });
  });
}
