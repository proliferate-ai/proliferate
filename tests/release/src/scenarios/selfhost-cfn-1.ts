import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ScenarioCellOutcome,
  ScenarioCellSpec,
  ScenarioDefinition,
  ScenarioPlanStep,
  ScenarioRunContext,
} from "./types.js";
import type { CandidateBuildMapV1 } from "../artifacts/build-map.js";
import type { SelfHostCfnCleanupEvidenceBlock, SelfHostCfnWrapperEvidenceV1 } from "../evidence/schema.js";
import type { PlannedCellV1, ResultReason, ScenarioDeclarableStatus } from "../runner/result.js";
import type { RunIdentityV1 } from "../runner/identity.js";
import { resolveSelfHostCandidateSet } from "../artifacts/selfhost-candidate-set.js";
import { materializeLocalArtifact } from "../artifacts/materialize-local.js";
import { openCleanupLedger } from "../worlds/local-workspace/cleanup-ledger.js";
import { runSubdomainLabel } from "../worlds/selfhost/dns.js";
import { waitForHealth } from "../worlds/selfhost/install.js";
import {
  QUALIFICATION_ZONE,
  SelfHostCfnCleanupStack,
  buildCfnParameters,
  buildCfnStackTags,
  bundleDigestBound,
  captureCfnBootstrapDiagnostic,
  cfnBootstrapDiagnosticArtifactPath,
  cfnSiteAddress,
  cfnStackName,
  createCfnStackAndWait,
  defaultCfnAwsExec,
  defaultDockerExec,
  defaultGhExec,
  imageDigestBound,
  outputsWellFormed,
  pushCandidateServerImage,
  runScopedImageTag,
  route53RecordAbsent,
  runtimeDigestBound,
  s3KeyPrefix,
  ssmInspectRunningImageDigest,
  templateFileSha256,
  tmpParameterFileIo,
  uploadBundleAndPresign,
  validateTemplate,
  writeCfnBootstrapDiagnosticArtifact,
  type CfnBootstrapDiagnosticArtifactV1,
  type CfnStackOutputs,
  type SelfHostCfnWorldCleanupEvidence,
} from "../worlds/selfhost/cfn.js";

/**
 * SELFHOST-CFN-1 (frozen tier-3 contract §`SH-CFN-WRAPPER`). ONE matrix
 * scenario, ONE journey-cell, lane `selfhost`, harness `claude`. The canonical
 * cell name `SH-CFN-WRAPPER` is carried as the `cell` dimension, giving a cell
 * id like `SELFHOST-CFN-1/selfhost/cell=SH-CFN-WRAPPER,harness=claude`.
 *
 * ── WHAT THIS PROVES (shallow wrapper, non-duplicative) ─────────────────────
 * The SHIPPED CloudFormation entry point (`server/infra/self-hosted-aws/
 * template.yaml`, the exact template `launch-stack.sh` deploys) installs the
 * EXACT candidate. The proof is deliberately SHALLOW per the frozen contract —
 * "verify candidate input digests, stack outputs, DNS/TLS, and `/meta` version.
 * Do not repeat the owner, invite, and Desktop authentication journey already
 * proved above." SELFHOST-INSTALL-1 owns claim/login/invite; this cell asserts
 * only that the wrapper stands up the candidate bytes correctly.
 *
 * ── CANDIDATE TRANSPORT (scenario-side, NOT the builder) ────────────────────
 * The self-host candidate builder is deliberately AWS-free (it docker-SAVES the
 * server image and writes the bundle locally; it "never provisions AWS, starts
 * a server, or claims anything"). PR 3 put ALL AWS actions scenario-side behind
 * the cleanup ledger, and this workstream follows that boundary: the SCENARIO
 * (via `cfn.ts` at world-build time) uploads + presigns the deploy bundle and
 * pushes the candidate server image, registering every cleanup intent BEFORE
 * the create. No builder flag is added — the registered-before-create truth is
 * only honest when the same code that owns the ledger performs the create.
 *
 * ── DIGEST RECEIPTS ─────────────────────────────────────────────────────────
 * - bundle: the presigned `DeployBundleUrl`/`DeployBundleChecksumUrl` point at
 *   the EXACT candidate `proliferate-deploy.tar.gz` + its SHA256SUMS; the stack
 *   `sha256sum -c`s them on the box. `bundle_digest_bound` = the uploaded sums
 *   list the candidate bundle sha256.
 * - runtime: the same run-scoped SHA256SUMS binds the EXACT arm64 runtime
 *   archive built from this source head; `RuntimeBinaryUrl` prevents the
 *   run-scoped server-image tag from being misread as a GitHub release tag.
 * - template: the bundle does NOT ship the template (`proliferate-deploy.tar.gz`
 *   is built from `server/deploy/**`; the template lives under
 *   `server/infra/self-hosted-aws/`), so the receipt is the REPO template's byte
 *   hash + a real `validate-template`, not a bundle-embedded copy.
 * - image: the run-scoped GHCR tag's running RepoDigest (read over SSM — the
 *   template provisions an SSM-enabled role) must equal the pushed digest. If
 *   SSM is unusable the binding falls back to `/meta` version + the immutable
 *   unique run tag (a per-run tag cannot have drifted).
 *
 * The Route53 A record is stack-owned (`CreateRoute53Record=true`), so its
 * deletion rides `delete-stack`; the cleanup block sets `route53_record_deleted`
 * from the stack deletion result.
 *
 * ── FAIL-CLOSED PREFLIGHT ───────────────────────────────────────────────────
 * `RELEASE_E2E_SELFHOST_CFN_BUCKET` and `RELEASE_E2E_SELFHOST_CFN_IMAGE_REPO`
 * are pending founder provisioning. When either is absent the cell FAILS CLOSED
 * (a required case is green or red; missing infra is red), never a silent skip.
 *
 * Unit tests are OFFLINE: they inject a fake `SelfHostCfnDriver` so no real
 * AWS/Docker/GitHub is touched.
 */

export const SELFHOST_CFN_1_ID = "SELFHOST-CFN-1";
export const REPRESENTATIVE_HARNESS = "claude";

/** The single `cell` dimension value this scenario declares. */
export const SH_CFN_WRAPPER = "SH-CFN-WRAPPER";

/** The two founder-provisioned inputs the cell fails closed without. */
export const RELEASE_E2E_SELFHOST_CFN_BUCKET = "RELEASE_E2E_SELFHOST_CFN_BUCKET";
export const RELEASE_E2E_SELFHOST_CFN_IMAGE_REPO = "RELEASE_E2E_SELFHOST_CFN_IMAGE_REPO";

/** The shipped CloudFormation template path, relative to the repo root. */
export const CFN_TEMPLATE_REPO_PATH = "server/infra/self-hosted-aws/template.yaml";

export const selfhostCfn1: ScenarioDefinition = {
  id: SELFHOST_CFN_1_ID,
  kind: "matrix",
  title:
    "prove the SHIPPED CloudFormation wrapper installs the EXACT candidate: input digests, stack outputs, " +
    "DNS/TLS, and /meta version (shallow — no owner/invite/Desktop journey)",
  registryFlowRef: "specs/developing/testing/tier-3-scenario-contract.md#sh-cfn-wrapper",
  lanes: ["selfhost"],
  // Region + hosted zone are legitimately-provisioned world inputs. The two
  // CFN-specific inputs are NOT scenario-level requiredEnv: they are resolved in
  // the orchestrator and FAIL CLOSED (red, never blocked) when absent.
  requiredEnv: ["RELEASE_E2E_SELFHOST_REGION", "RELEASE_E2E_SELFHOST_HOSTED_ZONE_ID"],
  expandCells: (): ScenarioCellSpec[] => [
    {
      dimensions: { cell: SH_CFN_WRAPPER, harness: REPRESENTATIVE_HARNESS },
      // The CFN bucket + image repo are founder-gated OPTIONAL env: resolved
      // into ctx.env when present so the stack proof runs for real, absent →
      // the cell fails CLOSED (red) rather than being runner-blocked
      // (PR7-CONTROL-004).
      optionalEnv: [RELEASE_E2E_SELFHOST_CFN_BUCKET, RELEASE_E2E_SELFHOST_CFN_IMAGE_REPO],
    },
  ],
  planCell: (_ctx, cell: PlannedCellV1): ScenarioPlanStep[] => planForCell(cell),
  runCells: async (ctx, cells): Promise<ScenarioCellOutcome[]> =>
    runSelfHostCfnCells(ctx, cells, defaultSelfHostCfnDriver),
};

function planForCell(cell: PlannedCellV1): ScenarioPlanStep[] {
  const prefix = `[${cell.cell_id}]`;
  return [
    { description: `${prefix} preflight the CFN bucket + GHCR image repo env; fail closed if absent` },
    { description: `${prefix} validate-template the repo template + record its byte-hash receipt` },
    { description: `${prefix} upload the candidate bundle + SHA256SUMS to S3 (registered-before-create) and presign bounded GET URLs` },
    { description: `${prefix} docker load + push the candidate server image to a run-scoped GHCR tag (registered-before-create)` },
    { description: `${prefix} create-stack with presigned bundle URLs + run-scoped image repo/tag, CreateRoute53Record=true; wait CREATE_COMPLETE` },
    { description: `${prefix} assert outputs well-formed, TLS + /health green, /meta serverVersion == candidate, image digest bound over SSM` },
    { description: `${prefix} tear down: delete-stack (+ its Route53 record), S3 objects, GHCR version; fold cleanup into evidence` },
  ];
}

// ── World handle (light: exactly one CloudFormation stack, no controller runtime) ──

/**
 * The ready CFN-wrapper world. Unlike the EC2 posture there is no
 * controller-local AnyHarness/renderer/browser — the stack owns the whole host.
 * Runtime observations (`/health`, `/meta`, the SSM digest read) are methods so
 * the cell logic is faked entirely offline.
 */
export interface ReadySelfHostCfnWorld {
  run: RunIdentityV1;
  artifactIds: string[];
  /** Candidate server version (the `/meta` serverVersion must equal this). */
  serverVersion: string;
  /** The requested run subdomain FQDN (SiteAddress parameter). */
  siteAddress: string;
  /** Safe API origin host recorded in evidence. */
  apiOrigin: string;
  stackName: string;
  templateSha256: string;
  templateValidated: boolean;
  bundleDigestBound: boolean;
  runtimeDigestBound: boolean;
  /** `sha256:<hex>` digest of the pushed candidate image. */
  pushedImageDigest: string;
  /** The run-scoped tag the candidate image was pushed under + passed as ReleaseVersion. */
  releaseVersionTag: string;
  outputs: CfnStackOutputs;
  /** SSM docker-inspect of the running api image RepoDigest (`sha256:<hex>`); throws if SSM is unusable. */
  inspectRunningImageDigest(): Promise<string>;
  /** Bounded TLS + `/health` gate over the public origin. */
  waitHealthy(): Promise<void>;
  /** Reads the public `/meta` version + base capability booleans. */
  fetchMeta(): Promise<{ serverVersion: string; cloudWorkspaces: boolean; agentGateway: boolean }>;
  /** Tears down (stack → GHCR → S3 → local paths) and returns the cleanup summary. */
  close(): Promise<SelfHostCfnWorldCleanupEvidence>;
}

/** World-construction inputs threaded off the scenario context + env. */
export interface CfnWorldInputs {
  map: CandidateBuildMapV1;
  run: RunIdentityV1;
  runDir: string;
  region: string;
  hostedZoneId: string;
  bucket: string;
  imageRepo: string;
}

export type SelfHostCfnWrapperEvidenceNoCleanup = Omit<SelfHostCfnWrapperEvidenceV1, "cleanup">;

export interface SelfHostCfnCellResult {
  status: ScenarioDeclarableStatus;
  reason?: ResultReason;
  /** Evidence sans the cleanup block; `undefined` on a failed cell. */
  evidence?: SelfHostCfnWrapperEvidenceNoCleanup;
}

// ── Driver seam (production wiring vs offline fakes) ─────────────────────────

export interface SelfHostCfnDriver {
  buildWorld(inputs: CfnWorldInputs): Promise<ReadySelfHostCfnWorld>;
  runCfnWrapper(world: ReadySelfHostCfnWorld): Promise<SelfHostCfnCellResult>;
  closeWorld(world: ReadySelfHostCfnWorld): Promise<SelfHostCfnWorldCleanupEvidence>;
}

export const defaultSelfHostCfnDriver: SelfHostCfnDriver = {
  buildWorld: (inputs) => constructSelfHostCfnWorld(inputs),
  runCfnWrapper: (world) => runCfnWrapperCell(world),
  closeWorld: (world) => world.close(),
};

/**
 * The real per-scenario orchestration, independent of the matrix plumbing so it
 * is directly unit-testable against a fake `SelfHostCfnDriver`:
 *   1. resolve inputs + preflight the CFN env (typed failure → the cell fails
 *      CLOSED; a build failure fails the cell without a close);
 *   2. build ONE CFN world (the wrapper install itself);
 *   3. run the single shallow-wrapper cell;
 *   4. close the world exactly once and fold the cleanup block into the
 *      evidence — a non-clean teardown downgrades an otherwise-green cell.
 */
export async function runSelfHostCfnCells(
  ctx: ScenarioRunContext,
  cells: readonly PlannedCellV1[],
  driver: SelfHostCfnDriver,
): Promise<ScenarioCellOutcome[]> {
  const wrapperCell = cells.find((cell) => cell.dimensions.cell === SH_CFN_WRAPPER);

  const inputs = resolveCfnWorldInputs(ctx);
  if (!inputs.ok) {
    return cells.map((cell) => failedOutcome(cell.cell_id, inputs.reason));
  }

  let world: ReadySelfHostCfnWorld;
  try {
    world = await driver.buildWorld(inputs.value);
  } catch (error) {
    return cells.map((cell) => failedOutcome(cell.cell_id, `world construction failed: ${describe(error)}`));
  }

  let result: SelfHostCfnCellResult;
  try {
    result = await driver.runCfnWrapper(world);
  } catch (error) {
    result = { status: "failed", reason: { code: "scenario_failure", message: describe(error) } };
  }

  let cleanup: SelfHostCfnWorldCleanupEvidence | undefined;
  let closeError: unknown;
  try {
    cleanup = await driver.closeWorld(world);
  } catch (error) {
    closeError = error;
  }

  return cells.map((cell) => {
    if (!wrapperCell || cell.cell_id !== wrapperCell.cell_id) {
      return failedOutcome(
        cell.cell_id,
        `SELFHOST-CFN-1 declares only the "${SH_CFN_WRAPPER}" cell; "${cell.cell_id}" was not expected.`,
      );
    }
    if (!result.evidence) {
      // A failed cell carries no evidence; the stack was still torn down above.
      return { cellId: cell.cell_id, status: result.status, reason: result.reason } satisfies ScenarioCellOutcome;
    }
    if (!cleanup) {
      return failedOutcome(cell.cell_id, `World cleanup threw before producing a summary: ${describe(closeError)}`);
    }
    const evidence = attachCfnCleanup(result.evidence, cleanup);
    if (result.status === "green" && !cleanupIsClean(cleanup)) {
      return {
        cellId: cell.cell_id,
        status: "failed",
        reason: {
          code: "scenario_failure",
          message: `World cleanup did not fully reconcile (failed=${cleanup.failed}).`,
        },
        evidence,
      } satisfies ScenarioCellOutcome;
    }
    return { cellId: cell.cell_id, status: result.status, reason: result.reason, evidence } satisfies ScenarioCellOutcome;
  });
}

// ── The shallow-wrapper cell (offline-tested against the fake world) ─────────

/**
 * The frozen contract's shallow assertions. Each evidence boolean is BACKED by
 * an observation; any failed check returns a bounded, secret-free `failed` with
 * NO evidence, never a partial green.
 */
export async function runCfnWrapperCell(world: ReadySelfHostCfnWorld): Promise<SelfHostCfnCellResult> {
  // Build-time receipts (validate-template, bundle-sums binding) were captured
  // during construction; re-assert them before the runtime checks.
  if (!world.templateValidated) {
    return fail("SH-CFN-WRAPPER: the shipped CloudFormation template failed validate-template.");
  }
  if (!world.bundleDigestBound) {
    return fail(
      "SH-CFN-WRAPPER: the uploaded SHA256SUMS did not bind the candidate deploy-bundle digest; " +
        "the stack would install an unverified bundle.",
    );
  }
  if (!world.runtimeDigestBound) {
    return fail(
      "SH-CFN-WRAPPER: the uploaded SHA256SUMS did not bind the candidate arm64 runtime digest; " +
        "the stack would install an unverified runtime.",
    );
  }

  // Outputs well-formed: BaseUrl == https://<SiteAddress>, SiteAddress == the
  // requested run subdomain, InstanceId present.
  if (!outputsWellFormed(world.outputs, world.siteAddress)) {
    return fail(
      `SH-CFN-WRAPPER: stack outputs are not well-formed for ${world.apiOrigin} ` +
        `(baseUrl/siteAddress/instanceId did not agree with the requested SiteAddress).`,
    );
  }

  // TLS + /health green over the public origin (real Caddy/Let's-Encrypt cert).
  try {
    await world.waitHealthy();
  } catch (error) {
    return fail(`SH-CFN-WRAPPER: public HTTPS /health was not green: ${describe(error)}`);
  }

  // /meta serverVersion == candidate; base capability truth (self-managed, no
  // hosted-web / cloud add-on) — deliberately NOT the owner/invite journey.
  let meta: { serverVersion: string; cloudWorkspaces: boolean; agentGateway: boolean };
  try {
    meta = await world.fetchMeta();
  } catch (error) {
    return fail(`SH-CFN-WRAPPER: GET /meta failed: ${describe(error)}`);
  }
  if (meta.serverVersion !== world.serverVersion) {
    return fail(
      `SH-CFN-WRAPPER: /meta serverVersion "${meta.serverVersion}" != candidate "${world.serverVersion}"; ` +
        "the wrapper did not install the exact candidate.",
    );
  }
  if (meta.cloudWorkspaces !== false) {
    return fail("SH-CFN-WRAPPER: /meta capabilities.cloudWorkspaces is true; a base CFN install must advertise no hosted-web/cloud add-on.");
  }
  if (meta.agentGateway !== false) {
    return fail("SH-CFN-WRAPPER: /meta capabilities.agentGateway is true; a base CFN install must advertise the gateway disabled.");
  }

  // Image-digest binding: the running api image RepoDigest (SSM docker-inspect)
  // must equal the pushed candidate digest. If SSM is unusable, fall back to the
  // /meta version match + the immutable unique run tag (a per-run tag cannot
  // have drifted), which the version-match above already established.
  // Image-digest binding is FAIL-CLOSED (PR7-CONTROL-006): the running api
  // image RepoDigest (SSM docker-inspect) MUST be readable AND equal the pushed
  // candidate digest. A /meta version-only match is NOT accepted as a substitute
  // — two builds can share a version, so version equality cannot prove the stack
  // pulled the exact pushed bytes. An unreadable digest is a red, not a pass.
  let observedImageDigest: string;
  try {
    observedImageDigest = await world.inspectRunningImageDigest();
  } catch (error) {
    return fail(
      "SH-CFN-WRAPPER: the running api image digest could not be read over SSM; the image-to-pushed-candidate " +
        `binding cannot be proven (failing closed, no version-only fallback): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!imageDigestBound(world.pushedImageDigest, observedImageDigest)) {
    return fail(
      "SH-CFN-WRAPPER: the running api image digest does not match the pushed candidate digest; " +
        "the stack pulled a different image than the one pushed.",
    );
  }

  const evidence: SelfHostCfnWrapperEvidenceNoCleanup = {
    kind: "selfhost_cfn_wrapper",
    artifact_ids: world.artifactIds,
    server_version: world.serverVersion,
    api_origin: world.apiOrigin,
    stack_name_hash: sha256Hex(world.stackName),
    // Record the actual inputs the binding rests on, so evidence is candidate-
    // specific (PR7-CONTROL-006): the pushed image digest, the run-scoped tag it
    // was pushed under, and the validated template's SHA-256.
    image_repo_digest: observedImageDigest,
    release_version_tag: world.releaseVersionTag,
    template_sha256: world.templateSha256,
    template_validated: true,
    bundle_digest_bound: true,
    runtime_digest_bound: true,
    image_digest_bound: true,
    outputs_valid: true,
    dns_tls_verified: true,
    meta_version_matches: true,
  };
  return { status: "green", evidence };
}

// ── Production world construction (composes cfn.ts ops behind the ledger) ─────

/**
 * Builds the CFN-wrapper world: open the run-scoped ledger + cleanup stack,
 * materialize the candidate bundle + server-image archive (registered-before-
 * create local paths), validate the template, upload+presign the bundle, push
 * the image, then create the stack and read Outputs. On any failure every
 * registered cleanup runs exactly once (reverse order) before the error
 * rethrows, so a partial build never leaks a stack/object/image.
 */
export async function constructSelfHostCfnWorld(inputs: CfnWorldInputs): Promise<ReadySelfHostCfnWorld> {
  const log = (message: string): void => void message;
  const candidateSet = resolveSelfHostCandidateSet(inputs.map);
  const expectedPlatformSuffix = "/linux/arm64";
  const runtimeBundle = candidateSet.runtimeBundle;
  if (!runtimeBundle) {
    throw new Error("SH-CFN-WRAPPER: candidate map is missing the required selfhost-runtime/linux/arm64 artifact.");
  }
  for (const [name, artifactId] of [
    ["server image", candidateSet.serverImage.artifact_id],
    ["deploy bundle", candidateSet.bundle.artifact_id],
    ["runtime bundle", runtimeBundle.artifact_id],
  ] as const) {
    if (!artifactId.endsWith(expectedPlatformSuffix)) {
      throw new Error(`SH-CFN-WRAPPER: ${name} artifact ${artifactId} does not match the template's linux/arm64 instance architecture.`);
    }
  }

  const cfnDir = path.join(inputs.runDir, "cfn");
  const artifactsDir = path.join(cfnDir, "artifacts");
  await mkdir(artifactsDir, { recursive: true });

  const ledger = await openCleanupLedger({
    runDir: cfnDir,
    runId: inputs.run.run_id,
    shardId: inputs.run.shard_id,
  });

  const aws = defaultCfnAwsExec;
  const docker = defaultDockerExec;
  const gh = defaultGhExec;

  // The run subdomain FQDN is deterministic, so we can wire the Route53 survivor
  // observation into the cleanup stack up front (PR7-CONTROL-008):
  // route53RecordDeleted is set only when the A record is OBSERVED absent after
  // delete-stack, not merely because the stack deleted.
  const subdomain = runSubdomainLabel(inputs.run.run_id, inputs.run.shard_id);
  const siteAddress = cfnSiteAddress(subdomain, QUALIFICATION_ZONE);
  const stack = new SelfHostCfnCleanupStack({
    ledger,
    log,
    observeRoute53RecordAbsent: () => route53RecordAbsent(aws, inputs.hostedZoneId, siteAddress, inputs.region),
  });

  try {
    // Local materialized paths tear down LAST (register first). run_directory
    // holds the ledger and is preserved if an earlier releaser fails.
    await stack.registerAcquire("run_directory", cfnDir, () => rmrf(cfnDir));
    await stack.registerAcquire("extracted_artifacts", artifactsDir, () => rmrf(artifactsDir));

    // Materialize (re-hash) the exact candidate bytes into run storage; the
    // SHA256SUMS sits next to the ORIGINAL bundle (builder sibling).
    const bundlePath = await materializeLocalArtifact(candidateSet.bundle, artifactsDir);
    const runtimePath = await materializeLocalArtifact(runtimeBundle, artifactsDir);
    const serverImagePath = await materializeLocalArtifact(candidateSet.serverImage, artifactsDir);
    const sumsPath = path.join(path.dirname(candidateSet.bundle.locator.path), "self-hosted-assets.SHA256SUMS");
    const sumsContent = await readFile(sumsPath, "utf8");
    const digestBound = bundleDigestBound(sumsContent, candidateSet.bundle.sha256);
    const runtimeBound = runtimeDigestBound(sumsContent, runtimeBundle.sha256);

    const templatePath = resolveRepoTemplatePath();
    const templateValidated = await validateTemplate(aws, templatePath, inputs.region);
    const templateSha256 = await templateFileSha256(templatePath);

    // Upload + presign the bundle (registers s3_object BEFORE each cp).
    const presigned = await uploadBundleAndPresign({
      exec: aws,
      region: inputs.region,
      bucket: inputs.bucket,
      keyPrefix: s3KeyPrefix(inputs.run.run_id, inputs.run.shard_id),
      bundlePath,
      runtimePath,
      sumsPath,
      registerCleanup: (kind, providerId, release) => stack.registerAcquire(kind, providerId, release),
      log,
    });

    // Push the candidate image (registers ghcr_package_version BEFORE the push).
    const tag = runScopedImageTag(inputs.run.run_id, inputs.run.shard_id);
    const pushed = await pushCandidateServerImage({
      docker,
      gh,
      archivePath: serverImagePath,
      targetRepo: inputs.imageRepo,
      tag,
      registerCleanup: (kind, providerId, release) => stack.registerAcquire(kind, providerId, release),
      log,
    });

    // Create the stack (registers cloudformation_stack BEFORE create).
    // subdomain/siteAddress were computed up front (for the Route53 observer).
    const stackName = cfnStackName(inputs.run.run_id, inputs.run.shard_id);
    // The template pulls `${ServerImageRepository}:${ReleaseVersion}`, so
    // ReleaseVersion MUST be the run-scoped tag the candidate was JUST pushed
    // under (`tag`) — NOT candidateSet.serverImage.version, which is a build
    // version string, not the pushed tag, and would make the stack pull a
    // different (or nonexistent) image (PR7-CONTROL-006).
    const parameters = buildCfnParameters({
      releaseVersion: tag,
      serverImageRepository: inputs.imageRepo,
      runtimeBinaryUrl: presigned.runtimeBinaryUrl,
      runtimeBinaryChecksumUrl: presigned.deployBundleChecksumUrl,
      deployBundleUrl: presigned.deployBundleUrl,
      deployBundleChecksumUrl: presigned.deployBundleChecksumUrl,
      siteAddress,
      hostedZoneId: inputs.hostedZoneId,
    });
    const outputs = await createCfnStackAndWait({
      exec: aws,
      stackName,
      templatePath,
      parameters,
      tags: buildCfnStackTags({
        stackName,
        runId: inputs.run.run_id,
        shardId: inputs.run.shard_id,
      }),
      region: inputs.region,
      registerCleanup: (kind, providerId, release) => stack.registerAcquire(kind, providerId, release),
      writeParameterFile: tmpParameterFileIo(),
      onCreateFailure: async ({ stackName: failedStackName, region }) => {
        const diagnostic = await captureCfnBootstrapDiagnostic({
          exec: aws,
          stackName: failedStackName,
          region,
        });
        const artifact: CfnBootstrapDiagnosticArtifactV1 = {
          schema_version: 1,
          kind: "proliferate.selfhost-cfn-bootstrap-diagnostic",
          run: {
            run_id: inputs.run.run_id,
            shard_id: inputs.run.shard_id,
            attempt: inputs.run.attempt,
            source_sha: inputs.run.source_sha,
          },
          diagnostic,
        };
        // This path is deliberately a sibling of `<runDir>/cfn`, not inside
        // it: the nested run-directory releaser may delete `cfn/` after the
        // callback returns, while the workflow's existing `**/logs/` glob must
        // retain this bounded artifact on the red run.
        await writeCfnBootstrapDiagnosticArtifact(
          cfnBootstrapDiagnosticArtifactPath(inputs.runDir),
          artifact,
        );
        return diagnostic;
      },
      log,
    });

    const apiOrigin = hostOf(outputs.baseUrl);
    return {
      run: inputs.run,
      artifactIds: [
        candidateSet.serverImage.artifact_id,
        candidateSet.bundle.artifact_id,
        runtimeBundle.artifact_id,
        candidateSet.anyharness.artifact_id,
        candidateSet.desktopRenderer.artifact_id,
      ],
      serverVersion: candidateSet.serverImage.version,
      siteAddress,
      apiOrigin,
      stackName,
      templateSha256,
      templateValidated,
      bundleDigestBound: digestBound,
      runtimeDigestBound: runtimeBound,
      pushedImageDigest: pushed.pushedDigest,
      releaseVersionTag: tag,
      outputs,
      inspectRunningImageDigest: () =>
        ssmInspectRunningImageDigest({ exec: aws, instanceId: outputs.instanceId, region: inputs.region, log }),
      waitHealthy: () => waitForHealth(`https://${siteAddress}`, {}),
      fetchMeta: () => fetchCfnMeta(`https://${siteAddress}`),
      close: () => stack.runAll(),
    };
  } catch (error) {
    await stack.runAll().catch(() => undefined);
    throw error;
  }
}

/** Reads the public `/meta` serverVersion + base capability booleans. */
async function fetchCfnMeta(
  apiBaseUrl: string,
): Promise<{ serverVersion: string; cloudWorkspaces: boolean; agentGateway: boolean }> {
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/meta`);
  if (!response.ok) {
    throw new Error(`GET /meta failed with HTTP ${response.status}.`);
  }
  const body = (await response.json()) as {
    serverVersion?: unknown;
    version?: unknown;
    capabilities?: { cloudWorkspaces?: unknown; agentGateway?: unknown };
  };
  const serverVersion = body.serverVersion ?? body.version;
  const capabilities = body.capabilities;
  if (
    typeof serverVersion !== "string" ||
    !capabilities ||
    typeof capabilities.cloudWorkspaces !== "boolean" ||
    typeof capabilities.agentGateway !== "boolean"
  ) {
    throw new Error("/meta did not carry a serverVersion string and capabilities.cloudWorkspaces/agentGateway booleans.");
  }
  return { serverVersion, cloudWorkspaces: capabilities.cloudWorkspaces, agentGateway: capabilities.agentGateway };
}

// ── Input resolution + preflight (fail-closed) ───────────────────────────────

/**
 * Resolves the CFN world inputs off the scenario context + env, failing CLOSED
 * (never throwing, never blocking) when the founder-provisioned CFN bucket /
 * GHCR image repo — or the base world inputs — are absent.
 */
export function resolveCfnWorldInputs(
  ctx: ScenarioRunContext,
): { ok: true; value: CfnWorldInputs } | { ok: false; reason: string } {
  const map = ctx.candidateBuildMap;
  if (!map) {
    return { ok: false, reason: "no candidate build map was supplied to this run; the cell cannot build a stack" };
  }
  if (!ctx.runIdentity) {
    return { ok: false, reason: "no run identity was threaded into the scenario context" };
  }
  if (!ctx.runDir) {
    return { ok: false, reason: "no run/shard-scoped run directory was threaded into the scenario context" };
  }
  let region: string;
  let hostedZoneId: string;
  try {
    region = ctx.env.require("RELEASE_E2E_SELFHOST_REGION");
    hostedZoneId = ctx.env.require("RELEASE_E2E_SELFHOST_HOSTED_ZONE_ID");
  } catch (error) {
    return { ok: false, reason: describe(error) };
  }
  const bucket = ctx.env.get(RELEASE_E2E_SELFHOST_CFN_BUCKET)?.trim();
  const imageRepo = ctx.env.get(RELEASE_E2E_SELFHOST_CFN_IMAGE_REPO)?.trim();
  if (!bucket) {
    return {
      ok: false,
      reason:
        `SH-CFN-WRAPPER: ${RELEASE_E2E_SELFHOST_CFN_BUCKET} is not set (pending founder provisioning of the ` +
        `qualification S3 bundle bucket). Failing closed: a required case is green or red, never a silent skip.`,
    };
  }
  if (!imageRepo) {
    return {
      ok: false,
      reason:
        `SH-CFN-WRAPPER: ${RELEASE_E2E_SELFHOST_CFN_IMAGE_REPO} is not set (pending founder provisioning of the ` +
        `run-scoped GHCR image repo). Failing closed: a required case is green or red, never a silent skip.`,
    };
  }
  return {
    ok: true,
    value: { map, run: ctx.runIdentity, runDir: ctx.runDir, region, hostedZoneId, bucket, imageRepo },
  };
}

// ── Evidence + cleanup projection ────────────────────────────────────────────

/** Stamps the CFN cleanup block into the wrapper evidence. */
export function attachCfnCleanup(
  evidence: SelfHostCfnWrapperEvidenceNoCleanup,
  cleanup: SelfHostCfnWorldCleanupEvidence,
): SelfHostCfnWrapperEvidenceV1 {
  const cleanupBlock: SelfHostCfnCleanupEvidenceBlock = {
    ledger_id_hash: cleanup.ledgerIdHash,
    registered: cleanup.registered,
    reconciled: cleanup.reconciled,
    failed: cleanup.failed,
    stack_deleted: cleanup.stackDeleted,
    s3_objects_deleted: cleanup.s3ObjectsDeleted,
    ghcr_version_deleted: cleanup.ghcrVersionDeleted,
    // Stack-owned Route53 record: its deletion rides delete-stack.
    route53_record_deleted: cleanup.route53RecordDeleted,
    local_paths_removed: cleanup.localPathsRemoved,
  };
  return { ...evidence, cleanup: cleanupBlock };
}

/** A green CFN cleanup: `failed === 0` and every deletion boolean true. */
export function cleanupIsClean(cleanup: SelfHostCfnWorldCleanupEvidence): boolean {
  return (
    cleanup.failed === 0 &&
    cleanup.stackDeleted &&
    cleanup.s3ObjectsDeleted &&
    cleanup.ghcrVersionDeleted &&
    cleanup.route53RecordDeleted &&
    cleanup.localPathsRemoved
  );
}

// ── Small shared helpers ─────────────────────────────────────────────────────

/**
 * Resolves the shipped CloudFormation template's absolute path by walking up
 * from both this module and the current working directory until the repo file
 * is found. Throws a bounded error (a real red) if it cannot be located.
 */
export function resolveRepoTemplatePath(): string {
  const starts = [path.dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 12; i += 1) {
      const candidate = path.join(dir, CFN_TEMPLATE_REPO_PATH);
      if (existsSync(candidate)) {
        return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }
  throw new Error(`SH-CFN-WRAPPER: could not locate the shipped template at ${CFN_TEMPLATE_REPO_PATH} from the repo tree.`);
}

function fail(message: string): SelfHostCfnCellResult {
  return { status: "failed", reason: { code: "scenario_failure", message } };
}

function failedOutcome(cellId: string, message: string): ScenarioCellOutcome {
  return { cellId, status: "failed", reason: { code: "scenario_failure", message } };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The safe host (never the raw URL/credentials) evidence records for an origin. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").split(/[/?#]/)[0] ?? url;
  }
}

async function rmrf(target: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await rm(target, { recursive: true, force: true });
}
