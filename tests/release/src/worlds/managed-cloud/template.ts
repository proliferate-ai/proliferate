import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Template, defaultBuildLogger, waitForTimeout } from "e2b";

import { lookupCachedTemplate, recordCachedTemplate } from "../../template/cache-manifest.js";
import type { MaterializedArtifact } from "../../artifacts/local-candidate-set.js";

/**
 * Builds and publishes the immutable E2B template baking the four musl binaries
 * and bootstrap inputs, and produces the composite `e2b-template/<name>` receipt
 * (spec "World construction" step 4). This makes the PR 1 stub
 * (`src/template/e2b-template-client.ts`) real for the managed-cloud world, per
 * the 2026-07-14 prework fact that E2B template publication works
 * non-interactively with the qualification team credentials.
 *
 * It reuses the production bake pattern (`scripts/build-template.mjs` via the
 * `e2b` `Template` builder API): every baked input is copied to `/home/user/...`
 * (NEVER `/tmp` — build-time `/tmp` does not survive to the runtime sandbox),
 * matching `.copy("anyharness", "/home/user/anyharness", ...)` etc. The base is
 * Debian 12 x86_64; the four binaries are the exact musl artifacts.
 *
 * The receipt records the provider template id, build id, the content-hash of
 * the inputs, and the exact sha256 of every baked input — the immutable
 * identity the scenario verifies against the running sandbox (spec step 4).
 * Registered in the cleanup ledger BEFORE creation; deleted in cleanup.
 */

/**
 * The exact inputs baked into the template. The four musl binaries are
 * materialized (re-hashed) artifacts; `bootstrapInputs` are additional files
 * baked under `/home/user/...` (e.g. an agent-pins/catalog file), each with the
 * `/home/user/...` destination it lands at.
 */
export interface ManagedCloudTemplateInputs {
  anyharness: MaterializedArtifact;
  worker: MaterializedArtifact;
  supervisor: MaterializedArtifact;
  credentialHelper: MaterializedArtifact;
  /** Extra baked files (destination MUST be under `/home/user/...`). */
  bootstrapInputs: BakedInput[];
  /** Agent CLI kinds baked in (aligns with server/proliferate/constants/cloud.py). */
  agentKinds: string[];
}

/** One baked input: a local source file and its `/home/user/...` destination. */
export interface BakedInput {
  /** Absolute local source path. */
  sourcePath: string;
  /** Destination inside the image; MUST start with `/home/user/`. */
  destination: string;
  mode?: number;
}

/** One baked-input digest recorded in the receipt. */
export interface BakedInputDigest {
  destination: string;
  sha256: string;
}

/**
 * The composite `e2b-template/<name>` receipt. Shaped so it folds into evidence
 * `artifact_ids` and drives the sandbox-identity assertion. It binds its inputs
 * in its own record and never mutates a sibling map entry.
 */
export interface E2bTemplateReceipt {
  /** `e2b-template/<run-scoped name>`. */
  artifact_id: string;
  /** Provider template id (immutable). */
  templateId: string;
  /** Provider build id (immutable). */
  buildId: string;
  /** Content hash over the ordered baked inputs (rebuild key). */
  inputHash: string;
  /** sha256 of every baked input, in bake order. */
  bakedInputs: BakedInputDigest[];
}

/** Typed E2B access for the build (path to a 0600 key file; no key value in a field). */
export interface E2bBuildConfig {
  teamId: string;
  /** Path to the mode-0600 file holding RELEASE_E2E_E2B_API_KEY. */
  secretsEnvFilePath: string;
  /** Run-scoped template family name, e.g. `<team>/proliferate-runtime-qual-<run>`. */
  templateName: string;
}

/**
 * The injectable E2B build seam — the real impl wraps the `e2b` `Template`
 * builder (`Template.build(...)`) exactly like `scripts/build-template.mjs`,
 * returning the provider template id + build id. Unit tests pass a fake so no
 * real E2B build, upload, or network happens offline.
 */
export interface ManagedCloudTemplateBuilder {
  buildAndPublish(
    inputs: ManagedCloudTemplateInputs,
    config: E2bBuildConfig,
  ): Promise<{ templateId: string; buildId: string; templateName: string }>;
  /** Deletes the built template (the `e2b_template` cleanup releaser). */
  deleteTemplate(templateId: string, config: E2bBuildConfig): Promise<void>;
}

/** The fixed `/home/user/...` destination every managed-cloud template bakes each binary to. */
export const MANAGED_CLOUD_TEMPLATE_DESTINATIONS = {
  anyharness: "/home/user/anyharness",
  worker: "/home/user/.proliferate/bin/proliferate-worker",
  supervisor: "/home/user/.proliferate/bin/proliferate-supervisor",
  credentialHelper: "/home/user/.proliferate/bin/proliferate-git-credential-helper",
} as const;

/**
 * The AnyHarness runtime home inside the sandbox. MUST equal what the server
 * launches `serve` with at runtime: `serve` receives no `--runtime-home`, so it
 * resolves `default_runtime_home()` = `$HOME/.proliferate/anyharness`, and the
 * launch script explicitly exports `HOME=/home/user`
 * (`SandboxRuntimeContext.base_env`, `integrations/sandbox/e2b.py`; mirrored by
 * `anyharness_runtime_home()` in `server/cloud/runtime/bootstrap.py`). The bake
 * pins the SAME home explicitly because a Docker/E2B build-stage `USER user`
 * does NOT update `$HOME` — an unpinned bake-time `install-agents` can resolve a
 * different default home, leaving the agents installed where the serving
 * runtime never looks (readiness then reports InstallRequired and
 * `GET /v1/agents/launch-options` returns zero launchable agents).
 */
export const MANAGED_CLOUD_ANYHARNESS_RUNTIME_HOME = "/home/user/.proliferate/anyharness";

const HOME_USER_PREFIX = "/home/user/";

/** Hard rule: build-time `/tmp` does not survive to the runtime sandbox — every baked destination must live under `/home/user/...`. */
function assertHomeUserDestination(destination: string): void {
  if (!destination.startsWith(HOME_USER_PREFIX)) {
    throw new Error(
      `Managed-cloud template baked input destination must start with "${HOME_USER_PREFIX}" (never /tmp — ` +
        `build-time /tmp does not survive to the runtime sandbox), got "${destination}".`,
    );
  }
}

/** Computes the sha256 of every baked input, in bake order (for the receipt). */
export async function computeBakedInputDigests(inputs: ManagedCloudTemplateInputs): Promise<BakedInputDigest[]> {
  const digests: BakedInputDigest[] = [
    { destination: MANAGED_CLOUD_TEMPLATE_DESTINATIONS.anyharness, sha256: inputs.anyharness.sha256 },
    { destination: MANAGED_CLOUD_TEMPLATE_DESTINATIONS.worker, sha256: inputs.worker.sha256 },
    { destination: MANAGED_CLOUD_TEMPLATE_DESTINATIONS.supervisor, sha256: inputs.supervisor.sha256 },
    { destination: MANAGED_CLOUD_TEMPLATE_DESTINATIONS.credentialHelper, sha256: inputs.credentialHelper.sha256 },
  ];
  for (const bootstrapInput of inputs.bootstrapInputs) {
    assertHomeUserDestination(bootstrapInput.destination);
    const contents = await readFile(bootstrapInput.sourcePath);
    const sha256 = createHash("sha256").update(contents).digest("hex");
    digests.push({ destination: bootstrapInput.destination, sha256 });
  }
  return digests;
}

/**
 * Computes a stable content hash over the ordered baked inputs (the four musl
 * binary sha256s + every bootstrap input's destination+sha256 + the agent
 * kinds), so an unchanged input set reuses the cached template ref (via
 * src/template/cache-manifest.ts, reused) and a changed one forces a rebuild.
 */
export async function computeManagedCloudTemplateHash(inputs: ManagedCloudTemplateInputs): Promise<string> {
  const digests = await computeBakedInputDigests(inputs);
  const hash = createHash("sha256");
  hash.update("baked_inputs");
  hash.update("\0");
  for (const digest of digests) {
    hash.update(digest.destination);
    hash.update("\0");
    hash.update(digest.sha256);
    hash.update("\0");
  }
  hash.update("agent_kinds");
  hash.update("\0");
  for (const agentKind of inputs.agentKinds) {
    hash.update(agentKind);
    hash.update("\0");
  }
  // The exact bake-time install command participates in the hash so a cached
  // template baked with a DIFFERENT command (e.g. before the runtime-home pin)
  // can never be reused on a same-run retry.
  hash.update("install_command");
  hash.update("\0");
  hash.update(buildAgentInstallCommand(inputs.agentKinds));
  hash.update("\0");
  return hash.digest("hex");
}

/** `templateId::buildId` — the only shape `cache-manifest.ts`'s generic `templateRef` string needs to carry for this world. */
function encodeTemplateRef(templateId: string, buildId: string): string {
  return `${templateId}::${buildId}`;
}

function decodeTemplateRef(templateRef: string): { templateId: string; buildId: string } {
  const separatorIndex = templateRef.indexOf("::");
  if (separatorIndex < 0) {
    throw new Error(`Cached managed-cloud template ref is malformed: "${templateRef}".`);
  }
  return {
    templateId: templateRef.slice(0, separatorIndex),
    buildId: templateRef.slice(separatorIndex + 2),
  };
}

export interface ResolveOrBuildManagedCloudTemplateOptions {
  inputs: ManagedCloudTemplateInputs;
  config: E2bBuildConfig;
  builder: ManagedCloudTemplateBuilder;
  /** Registered-before-create: writes the `e2b_template` ledger intent + acquired. */
  register: (providerId: string, release: () => Promise<void>) => Promise<void>;
  cacheDir?: string;
  log?: (message: string) => void;
}

/**
 * Resolves a template receipt for the given inputs, building only on a
 * content-hash cache miss (reusing the PR 1 cache-manifest concept). Registers
 * the `e2b_template` cleanup entry before creation. Verifies the provider
 * template/build ids are non-empty and returns the full receipt.
 *
 * Template family names are run-scoped (`E2bBuildConfig.templateName`), so a
 * cache hit only happens on a retry of the SAME run/shard with unchanged
 * inputs — never across runs. The registered release always deletes the
 * template on cleanup because it is exclusively owned by this run either way.
 */
export async function resolveOrBuildManagedCloudTemplate(
  options: ResolveOrBuildManagedCloudTemplateOptions,
): Promise<E2bTemplateReceipt> {
  const { inputs, config, builder, register, cacheDir, log = () => undefined } = options;

  for (const bootstrapInput of inputs.bootstrapInputs) {
    assertHomeUserDestination(bootstrapInput.destination);
  }

  const bakedInputs = await computeBakedInputDigests(inputs);
  const inputHash = await computeManagedCloudTemplateHash(inputs);
  const artifactId = `e2b-template/${config.templateName}`;

  const cached = await lookupCachedTemplate(inputHash, config.teamId, cacheDir);
  let templateId: string;
  let buildId: string;
  if (cached) {
    const decoded = decodeTemplateRef(cached.templateRef);
    templateId = decoded.templateId;
    buildId = decoded.buildId;
    log(`reusing cached managed-cloud template ${templateId} (build ${buildId}) for input hash ${inputHash}`);
  } else {
    log(`building managed-cloud template ${config.templateName} for input hash ${inputHash}`);
    const built = await builder.buildAndPublish(inputs, config);
    templateId = built.templateId;
    buildId = built.buildId;
    await recordCachedTemplate(
      inputHash,
      { templateRef: encodeTemplateRef(templateId, buildId), builtAt: new Date().toISOString(), e2bTeamId: config.teamId },
      cacheDir,
    );
  }

  if (templateId.length === 0 || buildId.length === 0) {
    throw new Error(`Managed-cloud template build for "${config.templateName}" returned an empty provider id.`);
  }

  await register(templateId, async () => {
    await builder.deleteTemplate(templateId, config);
  });

  return { artifact_id: artifactId, templateId, buildId, inputHash, bakedInputs };
}

/** Reads `RELEASE_E2E_E2B_API_KEY` out of the mode-0600 secrets env file (never argv, never a field). */
export function readE2bApiKey(secretsEnvFilePath: string): string {
  const raw = readFileSync(secretsEnvFilePath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (key === "RELEASE_E2E_E2B_API_KEY" || key === "E2B_API_KEY") {
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return value;
    }
  }
  throw new Error(`${secretsEnvFilePath} does not define RELEASE_E2E_E2B_API_KEY (or E2B_API_KEY).`);
}

/** Single-quotes a value for safe interpolation into a shell command string (POSIX `'\''` escaping). */
function shellQuoteArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Exported for the input-hash and the unit tests: the exact bake-time install
 * command. Pins BOTH `HOME` and `--runtime-home` to the serving runtime's home
 * (see `MANAGED_CLOUD_ANYHARNESS_RUNTIME_HOME`) so the baked agent artifacts
 * land exactly where `resolve_agent_with_env` looks at launch-options time.
 */
export function buildAgentInstallCommand(agentKinds: readonly string[]): string {
  const agentArgs = agentKinds.map((agentKind) => `--agent ${shellQuoteArg(agentKind)}`).join(" ");
  return [
    "set -eu",
    `echo "Preinstalling agents: ${agentKinds.join(", ")}"`,
    "export HOME=/home/user",
    `/home/user/anyharness install-agents --runtime-home ${MANAGED_CLOUD_ANYHARNESS_RUNTIME_HOME} ${agentArgs}`,
  ].join(" && ");
}

/**
 * Default builder wrapping the real `e2b` `Template` API (bakes under
 * `/home/user/...`), matching `scripts/build-template.mjs` verbatim. The E2B
 * API key VALUE is read only from the mode-0600 `secretsEnvFilePath`, never
 * passed via argv.
 */
export class E2bTemplateBuilder implements ManagedCloudTemplateBuilder {
  async buildAndPublish(
    inputs: ManagedCloudTemplateInputs,
    config: E2bBuildConfig,
  ): Promise<{ templateId: string; buildId: string; templateName: string }> {
    const apiKey = readE2bApiKey(config.secretsEnvFilePath);
    const contextDir = mkdtempSync(path.join(os.tmpdir(), "proliferate-managed-cloud-template-"));
    try {
      await copyFile(inputs.anyharness.path, path.join(contextDir, "anyharness"));
      await copyFile(inputs.worker.path, path.join(contextDir, "proliferate-worker"));
      await copyFile(inputs.supervisor.path, path.join(contextDir, "proliferate-supervisor"));
      await copyFile(inputs.credentialHelper.path, path.join(contextDir, "proliferate-git-credential-helper"));
      const bootstrapFileNames = new Map<string, string>();
      for (const [index, bootstrapInput] of inputs.bootstrapInputs.entries()) {
        const fileName = `bootstrap-${index}-${path.basename(bootstrapInput.destination)}`;
        await copyFile(bootstrapInput.sourcePath, path.join(contextDir, fileName));
        bootstrapFileNames.set(bootstrapInput.destination, fileName);
      }

      let template = Template({ fileContextPath: contextDir })
        .fromBaseImage()
        .setUser("root")
        // Install Node 22 exactly as the production template bake does
        // (scripts/build-template.mjs): the E2B base image ships Node v20.9.0,
        // but the bundled claude ACP adapter (claude-agent-acp) requires Node
        // 20.10+ — without this the runtime reports the claude harness
        // `readiness: unsupported` ("Claude ACP requires Node.js 20.10+, but
        // found Node.js v20.9.0"), so launch-options never lists a launchable
        // claude and step 8's gateway turn can never open. Pinning Node 22
        // matches what production serves, keeping the candidate faithful.
        .aptInstall(["ca-certificates", "curl"], { noInstallRecommends: true })
        .runCmd('bash -lc "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -"')
        .aptInstall("nodejs", { noInstallRecommends: true })
        .runCmd(
          [
            "rm -f /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx",
            "ln -sf /usr/bin/node /usr/local/bin/node",
            "ln -sf /usr/bin/npm /usr/local/bin/npm",
            "ln -sf /usr/bin/npx /usr/local/bin/npx",
          ],
          { user: "root" },
        )
        .copy("anyharness", MANAGED_CLOUD_TEMPLATE_DESTINATIONS.anyharness, { mode: 0o755 })
        .makeDir("/home/user/.proliferate/bin", { mode: 0o755, user: "user" })
        .copy("proliferate-worker", MANAGED_CLOUD_TEMPLATE_DESTINATIONS.worker, { mode: 0o755 })
        .copy("proliferate-supervisor", MANAGED_CLOUD_TEMPLATE_DESTINATIONS.supervisor, { mode: 0o755 })
        .copy("proliferate-git-credential-helper", MANAGED_CLOUD_TEMPLATE_DESTINATIONS.credentialHelper, {
          mode: 0o700,
        })
        .runCmd(
          `chown user:user ${MANAGED_CLOUD_TEMPLATE_DESTINATIONS.credentialHelper} && chmod 700 ${MANAGED_CLOUD_TEMPLATE_DESTINATIONS.credentialHelper}`,
          { user: "root" },
        )
        .makeDir("/home/user/workspace", { mode: 0o755, user: "user" });

      for (const bootstrapInput of inputs.bootstrapInputs) {
        const fileName = bootstrapFileNames.get(bootstrapInput.destination);
        if (!fileName) {
          throw new Error(`Bootstrap input "${bootstrapInput.destination}" was not staged into the build context.`);
        }
        template = template
          .makeDir(path.posix.dirname(bootstrapInput.destination), { mode: 0o755, user: "user" })
          .copy(fileName, bootstrapInput.destination, { mode: bootstrapInput.mode ?? 0o644 });
      }

      // setReadyCmd finalizes the builder chain (TemplateFinal), so the last
      // stage is assigned directly rather than reassigned into `template`.
      const finalTemplate = template
        .setUser("user")
        .runCmd(buildAgentInstallCommand(inputs.agentKinds))
        .setWorkdir("/home/user/workspace")
        .setReadyCmd(waitForTimeout(0));

      const buildInfo = await Template.build(finalTemplate, config.templateName, {
        apiKey,
        cpuCount: 4,
        memoryMB: 8192,
        onBuildLogs: defaultBuildLogger(),
      });

      return { templateId: buildInfo.templateId, buildId: buildInfo.buildId, templateName: config.templateName };
    } finally {
      rmSync(contextDir, { recursive: true, force: true });
    }
  }

  async deleteTemplate(templateId: string, config: E2bBuildConfig): Promise<void> {
    const apiKey = readE2bApiKey(config.secretsEnvFilePath);
    // Delete by (globally-unique) template id; no --team, which expects the team
    // slug not the configured UUID (same mismatch as the build namespace).
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    await run("e2b", ["template", "delete", templateId, "--yes"], {
      env: { ...process.env, E2B_API_KEY: apiKey },
      encoding: "utf8",
    });
  }
}
