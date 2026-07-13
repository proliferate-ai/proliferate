/**
 * `SH-INSTALL-CLAIM` — installs the exact candidate self-host bundle onto a
 * disposable EC2 instance the provisioner already reserved, over real TLS,
 * and completes the first-owner claim.
 *
 * This is a scenario action, not world preparation: `provisioner.ts` only
 * reserves capacity and hands over the exact candidate bundle handle. This
 * module performs the transitions release-worlds-and-fixtures.md's "Tier 3
 * Self-Host World" composed journey describes: install -> obtain the setup
 * token -> claim the administrator -> assert /setup is permanently closed.
 *
 * Never touches a shared durable staging identity: the owner/admin email is
 * derived from this run's id.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExecFn } from "./aws-cli.js";
import { scpUpload, scpUploadDirAsTar, sshExec, type SshTarget } from "./ssh.js";
import { ApiClient } from "../../../fixtures/http.js";
import { COMPOSE_OVER_SSH } from "../../../fixtures/selfhost.js";

const SETUP_TOKEN_PATH = "/var/lib/proliferate/setup/setup-token";

export interface InstallCandidateOptions {
  readonly exec: ExecFn;
  readonly target: SshTarget;
  readonly repoRoot: string;
  /** Local path to the saved candidate image tarball (dev-candidate-bundle.ts). */
  readonly imageTarPath: string;
  /** The exact tag the tarball was saved under, e.g. "proliferate-server:candidate-<shortsha>". */
  readonly imageTag: string;
  readonly log?: (line: string) => void;
}

/** Installs the deploy bundle + exact candidate image on the box. Does not claim. */
export async function installCandidateBundle(options: InstallCandidateOptions): Promise<void> {
  const log = options.log ?? (() => {});
  const [imageRepo, imageTagOnly] = splitImageRef(options.imageTag);

  log("[install] packaging server/deploy for transfer");
  const workDir = await mkdtemp(join(tmpdir(), "selfhost-e2e-install-"));
  const deployTar = join(workDir, "deploy.tar.gz");
  await options.exec("tar", ["-C", join(options.repoRoot, "server"), "-czf", deployTar, "deploy"], 60_000);

  log("[install] uploading deploy bundle");
  await sshExec(options.exec, options.target, "mkdir -p ~/proliferate");
  await scpUploadDirAsTar(options.exec, options.target, deployTar, "~/proliferate", 5 * 60_000);

  log(`[install] uploading candidate image tarball (${options.imageTarPath})`);
  await scpUpload(options.exec, options.target, options.imageTarPath, "/tmp/candidate-image.tar", 15 * 60_000);
  log("[install] docker load on the box");
  await sshExec(options.exec, options.target, "sudo docker load -i /tmp/candidate-image.tar && rm -f /tmp/candidate-image.tar", 10 * 60_000);

  log(`[install] writing .env.static (image ${imageRepo}:${imageTagOnly}, sslip fallback, self_managed telemetry)`);
  const envStatic = [
    "PROLIFERATE_USE_SSLIP_FALLBACK=true",
    "PROLIFERATE_TELEMETRY_MODE=self_managed",
    "PROLIFERATE_ANONYMOUS_TELEMETRY_DISABLED=true",
    `PROLIFERATE_SERVER_IMAGE=${imageRepo}`,
    `PROLIFERATE_SERVER_IMAGE_TAG=${imageTagOnly}`,
    "PROLIFERATE_HOST_BIN_DIR=/opt/proliferate/bin",
    "POSTGRES_DB=proliferate",
    "POSTGRES_USER=proliferate",
    "CORS_ALLOW_ORIGINS=http://localhost:1420,http://127.0.0.1:1420,http://tauri.localhost,tauri://localhost",
    "",
  ].join("\n");
  const envFile = join(workDir, ".env.static");
  await writeFile(envFile, envStatic, "utf8");
  await scpUpload(options.exec, options.target, envFile, "~/proliferate/deploy/.env.static", 30_000);

  log("[install] running bootstrap.sh (secrets, migrate, boot, health + TLS gate)");
  await sshExec(
    options.exec,
    options.target,
    "sudo mkdir -p /opt/proliferate/bin && cd ~/proliferate/deploy && sudo ./bootstrap.sh",
    10 * 60_000,
  );
}

export interface ClaimResult {
  readonly ownerEmail: string;
  readonly ownerPassword: string;
  readonly accessToken: string;
  readonly organizationId: string;
}

/**
 * Reads the first-run setup token over the control channel, claims the
 * instance through the real `/setup` form (never a direct DB write), asserts
 * the success page, asserts `/setup` is permanently closed (second-claim
 * rejection), and logs the owner in through the real password login route.
 */
export async function claimSelfHostOwner(options: {
  exec: ExecFn;
  target: SshTarget;
  baseUrl: string;
  runId: string;
}): Promise<ClaimResult> {
  const ownerEmail = `owner-${options.runId}@proliferate-selfhost-e2e.dev`;
  const ownerPassword = `proliferate-e2e-${options.runId}-owner`;

  const setupToken = await sshExec(
    options.exec,
    options.target,
    `cd ~/proliferate/deploy && ${COMPOSE_OVER_SSH} exec -T api cat ${SETUP_TOKEN_PATH} 2>/dev/null || true`,
  );
  const token = setupToken.trim();
  if (!token) {
    throw new Error("claimSelfHostOwner: could not read the first-run setup token off the box");
  }

  const claimBody = new URLSearchParams({ email: ownerEmail, password: ownerPassword, setup_token: token });
  const claimResponse = await fetch(`${options.baseUrl}/setup`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: claimBody.toString(),
  });
  const claimText = await claimResponse.text();
  if (!claimResponse.ok || !claimText.includes("You are all set")) {
    throw new Error(`claimSelfHostOwner: /setup claim did not succeed (${claimResponse.status}): ${claimText.slice(0, 300)}`);
  }

  const secondClaim = await fetch(`${options.baseUrl}/setup`);
  if (secondClaim.status !== 404) {
    throw new Error(
      `claimSelfHostOwner: PRODUCT BUG — /setup did not permanently close after claim; expected 404, got ${secondClaim.status}`,
    );
  }

  const client = new ApiClient({ baseUrl: options.baseUrl });
  const methods = await client.get<{ password_login?: boolean }>("/auth/desktop/methods");
  if (methods.password_login !== true) {
    throw new Error("claimSelfHostOwner: base install should advertise password login and did not");
  }

  const login = await client.post<{ access_token?: string; accessToken?: string }>("/auth/desktop/password/login", {
    email: ownerEmail,
    password: ownerPassword,
  });
  const accessToken = login.access_token ?? login.accessToken;
  if (!accessToken) {
    throw new Error("claimSelfHostOwner: owner password login returned no access token");
  }

  const orgs = await client
    .withBearerToken(accessToken)
    .get<{ organizations: Array<{ id: string; membership?: { role?: string; status?: string } }> }>("/v1/organizations");
  if (orgs.organizations.length !== 1) {
    throw new Error(`claimSelfHostOwner: expected exactly one instance org, got ${orgs.organizations.length}`);
  }
  const org = orgs.organizations[0];
  if (org.membership?.role !== "owner" || org.membership?.status !== "active") {
    throw new Error(`claimSelfHostOwner: claimer should be an active owner, got ${JSON.stringify(org.membership)}`);
  }

  return { ownerEmail, ownerPassword, accessToken, organizationId: org.id };
}

function splitImageRef(imageTag: string): [repo: string, tag: string] {
  const idx = imageTag.lastIndexOf(":");
  if (idx === -1) return [imageTag, "latest"];
  return [imageTag.slice(0, idx), imageTag.slice(idx + 1)];
}
